// デモ用ランタイム。本番のサーバー（Node.js + SQLite）の役割をブラウザ内で再現し、
// 本物の公開サイトの表示処理（src/views.js）とスタッフアプリ（staff/app.js）をそのまま動かす。
/* global __ES, ES_MODULES, startStaff */
(() => {
  'use strict';
  const STATUSES = { available: '販売中', sold: '売約済み', hidden: '非公開' };
  const LIMITS = { owner: 2, staff: 20 };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 23);
  const jstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const daysAgo = (n) => new Date(Date.now() + 9 * 3600e3 - n * 864e5).toISOString().slice(0, 10);
  class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

  // ---------- データ（サーバーのデータベースの代わり） ----------
  let DB;
  function resetDb() {
    const seed = clone(__ES.seed);
    // 見本の入荷日を「今日」基準にずらす（いつ開いても新着が並ぶように）
    const latest = seed.items.reduce((m, i) => (i.arrived_at > m ? i.arrived_at : m), '0000');
    const shift = Math.round((new Date(jstToday()) - new Date(latest)) / 864e5);
    for (const it of seed.items) {
      const d = new Date(it.arrived_at); d.setUTCDate(d.getUTCDate() + shift);
      it.arrived_at = d.toISOString().slice(0, 10);
      if (it.status === 'sold') it.sold_at = new Date(Date.now() - 2 * 3600e3).toISOString().replace('T', ' ').slice(0, 19);
      it.updated_at = stamp();
    }
    DB = {
      items: seed.items,
      settings: seed.settings,
      users: [
        { id: 1, login: 'tencho', name: '店主', role: 'owner', active: 1, password: 'demo1234', created_at: stamp() },
        { id: 2, login: 'staff1', name: '佐藤', role: 'staff', active: 1, password: 'demo1234', created_at: stamp() },
      ],
      logs: [],
      seq: Math.max(...seed.items.map((i) => i.id)) + 1,
      session: null,
    };
  }

  const items = {
    getByNo: (no) => DB.items.find((i) => i.no === String(no)) || null,
    visible(it) {
      if (it.status === 'available') return true;
      if (it.status !== 'sold') return false;
      const cut = new Date(Date.now() - (Number(DB.settings.soldVisibleDays) || 0) * 864e5).toISOString().replace('T', ' ').slice(0, 19);
      return (it.sold_at || '') >= cut;
    },
    listPublic({ category, status, q, sort } = {}) {
      let list = DB.items.filter(items.visible);
      if (category) list = list.filter((i) => i.category === category);
      if (status === 'available' || status === 'sold') list = list.filter((i) => i.status === status);
      if (q) list = list.filter((i) => i.species.includes(q) || i.morph.includes(q) || i.no === q || i.note.includes(q));
      const price = (dir) => (a, b) => (a.price_ask - b.price_ask) || ((a.price == null) - (b.price == null)) || dir * ((a.price ?? 0) - (b.price ?? 0));
      const order = { price_asc: price(1), price_desc: price(-1), name: (a, b) => a.species.localeCompare(b.species, 'ja') || a.morph.localeCompare(b.morph, 'ja') }[sort]
        || ((a, b) => b.arrived_at.localeCompare(a.arrived_at) || b.id - a.id);
      return list.sort((a, b) => ((a.status === 'sold') - (b.status === 'sold')) || order(a, b)).map(clone);
    },
    isNew: (it) => it.status === 'available' && it.arrived_at >= daysAgo(Number(DB.settings.newDays) || 14),
    listNewArrivals(limit = 12) {
      return DB.items.filter(items.isNew).sort((a, b) => b.arrived_at.localeCompare(a.arrived_at) || b.id - a.id).slice(0, limit).map(clone);
    },
    countsPublic() {
      const out = {};
      for (const i of DB.items) if (i.status === 'available') out[i.category] = (out[i.category] || 0) + 1;
      return [...Object.entries(out).map(([category, n]) => ({ category, n })), { category: '__sold', n: DB.items.filter((i) => i.status === 'sold' && items.visible(i)).length }];
    },
  };

  // ---------- 本番のモジュールを読み込む ----------
  const uploads = new Map();
  const shims = {
    './db': { STATUSES, DATA_DIR: '', getSettings: () => DB.settings },
    './items': items,
    'node:crypto': { createHash: () => ({ update() { return this; }, digest: () => Math.random().toString(16).slice(2).padEnd(24, '0') }) },
    'node:fs': { existsSync: () => false, writeFileSync: (file, buf) => uploads.set(file.split('/').pop(), URL.createObjectURL(new Blob([buf]))) },
    'node:path': { join: (...a) => a.join('/') },
    exceljs: window.ExcelJS,
  };
  const load = (name) => { const module = { exports: {} }; ES_MODULES[name]((n) => shims[n], module, module.exports); return module.exports; };
  const views = load('./views');
  const importer = load('./importer');

  // ---------- リアルタイム通知（Server-Sent Events の代わり） ----------
  const bus = new Set();
  const net = { staffOnline: true };
  function broadcast(type, data) {
    for (const es of bus) if (es.kind !== 'staff' || net.staffOnline) es.emit(type, data);
  }
  class FakeEventSource {
    constructor(kind) { this.kind = kind; this.l = {}; bus.add(this); setTimeout(() => this.emit('open'), 30); }
    addEventListener(t, fn) { (this.l[t] ||= []).push(fn); }
    emit(t, data) { for (const fn of this.l[t] || []) fn({ data: JSON.stringify(data ?? {}) }); }
    close() { bus.delete(this); }
  }

  // ---------- スタッフ用 API（Express の代わり） ----------
  function log(user, item, action, detail = {}) {
    DB.logs.unshift({ id: DB.logs.length + 1, at: new Date().toISOString().replace('T', ' ').slice(0, 19), user_name: user.name, item_no: item.no, action, detail });
  }
  const notify = (it) => broadcast('item', { id: it.id, no: it.no, status: it.status, updated_at: it.updated_at });
  function setStatus(user, no, status) {
    if (!STATUSES[status]) throw new HttpError(400, 'ステータスが不正です');
    const it = items.getByNo(no);
    if (!it) throw new HttpError(404, `管理番号 ${no} は見つかりません`);
    if (it.status === status) return it;
    log(user, it, 'status', { from: it.status, to: status });
    it.status = status;
    if (status === 'sold') it.sold_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    if (status === 'available') it.sold_at = null;
    it.updated_at = stamp();
    notify(it);
    return it;
  }
  const EDITABLE = ['category', 'species', 'morph', 'sex', 'size', 'origin', 'birth', 'arrived_at', 'note'];
  function applyFields(it, input) {
    const changes = {};
    for (const k of EDITABLE) if (input[k] !== undefined && String(input[k]).trim() !== it[k]) { changes[k] = 1; it[k] = String(input[k] ?? '').trim(); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(it.arrived_at)) it.arrived_at = jstToday();
    if (Array.isArray(input.photos)) it.photos = input.photos.map(String);
    let priceChange = null;
    if ('price' in input || 'price_ask' in input) {
      const p = input.price === '' || input.price == null ? null : Math.round(Number(String(input.price).replace(/[^\d.]/g, '')));
      const np = 'price' in input ? (Number.isFinite(p) ? p : null) : it.price;
      const na = 'price_ask' in input ? !!input.price_ask : it.price_ask;
      if (np !== it.price || na !== it.price_ask) priceChange = { price: { from: it.price, to: np }, price_ask: { from: it.price_ask, to: na } };
      it.price = np; it.price_ask = na;
    }
    return { changes, priceChange };
  }
  function nextNo(reserved = []) {
    const nums = [...DB.items.map((i) => i.no), ...reserved].filter((n) => /^\d+$/.test(n)).map(Number);
    return String(Math.max(0, ...nums) + 1);
  }
  function create(user, input, silent) {
    if (!String(input.species || '').trim()) throw new HttpError(400, '種名は必須です');
    const no = String(input.no ?? '').trim() || nextNo();
    if (items.getByNo(no)) throw new HttpError(409, `管理番号 ${no} は既に使われています`);
    const it = { id: DB.seq++, no, category: '', species: '', morph: '', sex: '', size: '', origin: '', birth: '', arrived_at: jstToday(), price: null, price_ask: false, status: 'available', sold_at: null, note: '', photos: [], created_at: stamp(), updated_at: stamp() };
    applyFields(it, input);
    if (STATUSES[input.status]) it.status = input.status;
    if (it.status === 'sold') it.sold_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    DB.items.push(it);
    log(user, it, 'create');
    if (!silent) notify(it);
    return it;
  }
  function update(user, no, input, silent) {
    const it = items.getByNo(no);
    if (!it) throw new HttpError(404, `管理番号 ${no} は見つかりません`);
    const newNo = String(input.no ?? '').trim();
    if (newNo && newNo !== it.no) {
      if (items.getByNo(newNo)) throw new HttpError(409, `管理番号 ${newNo} は既に使われています`);
      it.no = newNo;
    }
    const { changes, priceChange } = applyFields(it, input);
    if (priceChange) log(user, it, 'price', priceChange);
    else if (Object.keys(changes).length) log(user, it, 'edit');
    it.updated_at = stamp();
    if (STATUSES[input.status] && input.status !== it.status) return setStatus(user, it.no, input.status);
    if (!silent) notify(it);
    return it;
  }

  async function handle(method, path, query, body, form) {
    const user = DB.session && DB.users.find((u) => u.id === DB.session && u.active);
    const owner = () => { if (user.role !== 'owner') throw new HttpError(403, 'この操作は店主のみ可能です'); };
    if (path === '/setup-needed') return { needed: false };
    if (path === '/login' && method === 'POST') {
      const u = DB.users.find((x) => x.login === String(body.login || '').trim() && x.active);
      if (!u || u.password !== body.password) throw new HttpError(401, 'IDまたはパスワードが違います');
      DB.session = u.id;
      return { ok: true };
    }
    if (path === '/logout') { DB.session = null; return { ok: true }; }
    if (!user) throw new HttpError(401, 'ログインしてください');
    if (path === '/me') return { user: { id: user.id, login: user.login, name: user.name, role: user.role }, limits: LIMITS, categories: DB.settings.categories };
    if (path === '/items' && method === 'GET') return { items: [...DB.items].sort((a, b) => b.updated_at.localeCompare(a.updated_at)) };
    if (path === '/items' && method === 'POST') { owner(); return { item: create(user, body) }; }
    if (path === '/next-no') { owner(); return { no: nextNo() }; }
    let m = path.match(/^\/items\/([^/]+)(\/status|\/photos)?$/);
    if (m) {
      const no = decodeURIComponent(m[1]);
      if (m[2] === '/status') return { item: setStatus(user, no, body.status) };
      if (m[2] === '/photos') {
        owner();
        const it = items.getByNo(no);
        const file = form.get('photo');
        return { item: update(user, no, { photos: [...it.photos, URL.createObjectURL(file)] }) };
      }
      if (method === 'GET') { const it = items.getByNo(no); if (!it) throw new HttpError(404, `管理番号 ${no} は見つかりません`); return { item: it }; }
      if (method === 'PATCH') { owner(); return { item: update(user, no, body) }; }
      if (method === 'DELETE') {
        owner();
        const it = items.getByNo(no);
        DB.items = DB.items.filter((i) => i !== it);
        log(user, it, 'delete');
        broadcast('item', { id: it.id, no: it.no, status: 'deleted' });
        return { ok: true };
      }
    }
    if (path === '/import/preview') {
      owner();
      const file = form.get('file');
      const text = form.get('text');
      if (!(file instanceof File && file.size) && !text) throw new HttpError(400, 'ファイルを選ぶか、文章を貼り付けてください');
      const isFile = file instanceof File && file.size;
      if (isFile && /\.xlsx$/i.test(file.name) && !window.ExcelJS) throw new HttpError(400, 'このデモ環境ではExcelを読み込めませんでした。CSVか文章で試してください（本番ではExcelも読み込めます）');
      const res = await importer.parseAny({ buffer: isFile ? new Uint8Array(await file.arrayBuffer()) : undefined, filename: isFile ? file.name : '', text: isFile ? undefined : text, categories: DB.settings.categories });
      for (const r of res.rows) {
        r._exists = !!(r.no && items.getByNo(r.no));
        if (r.photos) r.photos = r.photos.map((u) => uploads.get(u.split('/').pop()) || u);
      }
      return res;
    }
    if (path === '/import/commit') {
      owner();
      const result = { created: 0, updated: 0, errors: [] };
      const reserved = body.rows.map((r) => String(r.no ?? '').trim()).filter(Boolean);
      for (const [i, raw] of body.rows.entries()) {
        const { _warnings, _exists, ...r } = raw;
        try {
          if (!String(r.no ?? '').trim()) { r.no = nextNo(reserved); reserved.push(r.no); }
          if (items.getByNo(r.no)) { update(user, r.no, r, true); result.updated++; }
          else { create(user, { ...r, status: r.status || (body.newStatus === 'hidden' ? 'hidden' : 'available') }, true); result.created++; }
        } catch (e) { result.errors.push({ row: i + 1, no: r.no, message: e.message }); }
      }
      broadcast('reload', {});
      return result;
    }
    if (path === '/logs') { owner(); return { logs: DB.logs.slice(0, 200) }; }
    if (path === '/settings' && method === 'GET') { owner(); return { settings: DB.settings }; }
    if (path === '/settings' && method === 'PUT') { owner(); Object.assign(DB.settings, body); broadcast('reload', {}); return { settings: DB.settings }; }
    if (path === '/users' && method === 'GET') { owner(); return { users: DB.users.map(({ password, ...u }) => u), limits: LIMITS }; }
    const active = (role) => DB.users.filter((u) => u.role === role && u.active).length;
    if (path === '/users' && method === 'POST') {
      owner();
      const { login, name, password, role = 'staff' } = body;
      if (!/^[a-zA-Z0-9_.-]{2,32}$/.test(String(login || '').trim())) throw new HttpError(400, 'IDは半角英数字2〜32文字で入力してください');
      if (!String(name || '').trim()) throw new HttpError(400, '表示名を入力してください');
      if (String(password || '').length < 6) throw new HttpError(400, 'パスワードは6文字以上にしてください');
      if (active(role) >= LIMITS[role]) throw new HttpError(400, `${role === 'owner' ? '店主' : 'スタッフ'}は最大${LIMITS[role]}名までです`);
      if (DB.users.some((u) => u.login === login.trim())) throw new HttpError(409, 'そのIDは既に使われています');
      DB.users.push({ id: DB.users.length + 1, login: login.trim(), name: name.trim(), role, active: 1, password, created_at: stamp() });
      return { ok: true };
    }
    m = path.match(/^\/users\/(\d+)$/);
    if (m && method === 'PATCH') {
      owner();
      const u = DB.users.find((x) => x.id === Number(m[1]));
      if (body.active !== undefined) {
        const next = body.active ? 1 : 0;
        if (next && !u.active && active(u.role) >= LIMITS[u.role]) throw new HttpError(400, `${u.role === 'owner' ? '店主' : 'スタッフ'}は最大${LIMITS[u.role]}名までです`);
        if (!next && u.role === 'owner' && active('owner') <= 1) throw new HttpError(400, '店主が0名になる変更はできません');
        u.active = next;
      }
      if (body.password) u.password = body.password;
      return { ok: true };
    }
    throw new HttpError(404, 'Not found');
  }

  async function fakeFetch(url, opts = {}) {
    if (!net.staffOnline) throw new TypeError('Failed to fetch');
    await new Promise((r) => setTimeout(r, 40)); // 通信の待ち時間をそれらしく
    const u = new URL(url, 'https://demo.local');
    const path = u.pathname.replace(/^\/api/, '');
    const form = opts.body instanceof FormData ? opts.body : null;
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : {};
    try {
      const data = clone(await handle(opts.method || 'GET', path, Object.fromEntries(u.searchParams), body, form));
      return { ok: true, status: 200, json: async () => data };
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      const status = e.status || 500;
      return { ok: false, status, json: async () => ({ error: status >= 500 ? 'サーバーでエラーが発生しました' : e.message }) };
    }
  }

  // ---------- 画面（Shadow DOM で本番の CSS をそのまま当てる） ----------
  function shadowCss(css) {
    return css
      .replace(/:root:not\(\[data-theme="light"\]\)/g, ':host')
      .replace(/:root\[data-theme="dark"\]/g, ':host-context([data-theme="dark"])')
      .replace(/:root/g, ':host')
      .replace(/(^|[\s,}])html\s*,\s*body(\s*\{)/gm, '$1.es-body$2')
      .replace(/(^|[\s,}])html(\s*\{)/gm, '$1.es-html$2')
      .replace(/(^|[\s,}])body(\s*[{:])/gm, '$1.es-body$2')
      .replace(/92vh/g, 'calc(var(--screen-h) * .92)')
      .replace(/100vh/g, 'var(--screen-h)')
      .replace(/(\d+)vw/g, '$1cqi') // 画面幅の指定を、端末の枠の幅基準に
      .replace(/@media \(max-width: (\d+)px\)/g, '@container screen (max-width: $1px)');
  }
  const FRAME_CSS = '.es-body{height:100%;overflow-y:auto;overflow-x:hidden;container-type:inline-size;container-name:screen;-webkit-overflow-scrolling:touch}';
  function mount(host, css) {
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${FRAME_CSS}${shadowCss(css)}</style><div class="es-body"></div>`;
    host.style.setProperty('--screen-h', `${host.clientHeight}px`);
    return { root, body: root.querySelector('.es-body') };
  }

  // ---------- 公開サイト ----------
  const site = { host: null, root: null, body: null, route: '/', es: null, changed: new Set(), timer: null };
  function navigate(href, keepScroll) {
    site.route = href;
    const u = new URL(href, 'https://demo.local');
    const q = Object.fromEntries(u.searchParams);
    const s = DB.settings;
    let html;
    if (u.pathname === '/') html = views.home(s);
    else if (u.pathname === '/stock') html = views.stock(s, q);
    else if (u.pathname === '/shop') html = views.shop(s);
    else if (u.pathname.startsWith('/item/')) {
      const it = items.getByNo(decodeURIComponent(u.pathname.slice(6)));
      html = it && it.status !== 'hidden' ? views.detail(s, clone(it)) : views.notFound(s);
    } else html = views.notFound(s);
    const doc = new DOMParser().parseFromString(html.split('/img/icon.svg').join(__ES.icon), 'text/html');
    // 本番では並び替えを選ぶとページを読み直す。デモではページ内で切り替えるので、その指定を外す
    doc.querySelectorAll('[onchange]').forEach((el) => el.removeAttribute('onchange'));
    const active = site.root.activeElement;
    const typing = active?.matches?.('.search') ? { value: active.value, pos: active.selectionStart } : null;
    const top = site.body.scrollTop;
    site.body.innerHTML = doc.body.innerHTML;
    site.body.scrollTop = keepScroll ? top : 0;
    if (typing) { const el = site.root.querySelector('.search'); if (el) { el.value = typing.value; el.focus(); el.setSelectionRange(typing.pos, typing.pos); } }
    const pill = site.root.getElementById('livePill');
    pill.hidden = false;
    document.getElementById('siteUrl').textContent = `exotic-supply.jp${href === '/' ? '' : href}`;
  }
  function siteRefresh() {
    clearTimeout(site.timer);
    site.timer = setTimeout(() => {
      navigate(site.route, true);
      for (const no of site.changed) site.root.querySelectorAll(`[data-no="${CSS.escape(no)}"]`).forEach((el) => el.classList.add('changed'));
      site.changed.clear();
      const pill = site.root.getElementById('livePill');
      const text = site.root.getElementById('liveText');
      pill.classList.add('flash'); text.textContent = '在庫が更新されました';
      setTimeout(() => { pill.classList.remove('flash'); text.textContent = '在庫をリアルタイム表示中'; }, 2500);
    }, 300);
  }
  function startSite() {
    site.host = document.getElementById('siteScreen');
    Object.assign(site, mount(site.host, __ES.cssSite));
    site.root.addEventListener('click', (e) => {
      const thumb = e.target.closest('.gallery-thumbs button');
      if (thumb) {
        site.root.getElementById('mainPhoto').src = thumb.dataset.src;
        thumb.parentElement.querySelectorAll('button').forEach((x) => x.toggleAttribute('aria-current', x === thumb));
        return;
      }
      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (href.startsWith('/')) { e.preventDefault(); navigate(href); }
      else if (/^tel:/.test(href)) { e.preventDefault(); toastOuter(`電話番号 ${href.slice(4)}（デモでは発信しません）`); }
    });
    site.root.addEventListener('submit', (e) => {
      e.preventDefault();
      const p = new URLSearchParams(new FormData(e.target));
      for (const [k, v] of [...p]) if (!v) p.delete(k);
      navigate(`/stock${p.toString() ? `?${p}` : ''}`);
    });
    site.root.addEventListener('change', (e) => { if (e.target.form && e.target.matches('select, input[type=checkbox]')) e.target.form.requestSubmit(); });
    site.es?.close();
    site.es = new FakeEventSource('site');
    site.es.addEventListener('item', (e) => { site.changed.add(JSON.parse(e.data).no); siteRefresh(); });
    site.es.addEventListener('reload', siteRefresh);
    navigate(site.route);
  }

  // ---------- スタッフアプリ ----------
  let staffEnv = null;
  function startStaffApp() {
    staffEnv?.dispose();
    // 切り替えのたびに画面ごと作り直す（前のログインの処理が新しい画面に触れないように）
    const old = document.getElementById('staffScreen');
    const host = old.cloneNode(false);
    old.replaceWith(host);
    const { root, body } = mount(host, __ES.cssStaff);
    body.innerHTML = __ES.staffBody;
    const memory = new Map();
    const listeners = [];
    const timers = [];
    const sources = [];
    staffEnv = {
      document: {
        getElementById: (id) => root.getElementById(id),
        querySelector: (s) => root.querySelector(s),
        querySelectorAll: (s) => root.querySelectorAll(s),
        createElement: (t) => document.createElement(t),
        body: { appendChild: (el) => body.appendChild(el) },
        addEventListener: (...a) => root.addEventListener(...a),
        get activeElement() { return root.activeElement; },
      },
      fetch: fakeFetch,
      EventSource: class extends FakeEventSource { constructor() { super('staff'); sources.push(this); } },
      localStorage: { getItem: (k) => (memory.has(k) ? memory.get(k) : null), setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) },
      confirm: () => true, // デモでは確認ダイアログを省略
      prompt: () => 'demo1234',
      online: () => net.staffOnline,
      on: (t, fn) => listeners.push([t, fn]),
      setInterval: (fn, ms) => timers.push(setInterval(fn, ms)),
      openSite: () => { showPanel('site'); navigate('/'); },
      emit: (t) => listeners.filter(([x]) => x === t).forEach(([, fn]) => fn()),
      dispose: () => { timers.forEach(clearInterval); sources.forEach((s) => s.close()); },
    };
    startStaff(staffEnv);
  }

  // ---------- デモの操作パネル ----------
  function toastOuter(msg) {
    const t = document.getElementById('demoToast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastOuter.t); toastOuter.t = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function loginAs(login) {
    DB.session = DB.users.find((u) => u.login === login).id;
    document.querySelectorAll('[data-login]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.login === login)));
    startStaffApp();
  }
  function setOnline(on) {
    net.staffOnline = on;
    const b = document.getElementById('netToggle');
    b.setAttribute('aria-pressed', String(!on));
    b.textContent = on ? '圏外にしてみる' : '電波を戻す';
    staffEnv?.emit(on ? 'online' : 'offline');
    if (on) for (const es of bus) if (es.kind === 'staff') es.emit('open');
  }
  function showPanel(name) {
    document.querySelectorAll('[data-panel]').forEach((p) => { p.dataset.active = String(p.dataset.panel === name); });
    document.querySelectorAll('[data-show]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.show === name)));
  }
  function setSiteMode(mode) {
    document.querySelector('.stage').dataset.siteMode = mode;
    document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    requestAnimationFrame(() => { site.host.style.setProperty('--screen-h', `${site.host.clientHeight}px`); });
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.login) loginAs(t.dataset.login);
    else if (t.id === 'netToggle') setOnline(!net.staffOnline);
    else if (t.dataset.show) showPanel(t.dataset.show);
    else if (t.dataset.mode) setSiteMode(t.dataset.mode);
    else if (t.id === 'resetDemo') { resetDb(); setOnline(true); site.route = '/'; startSite(); loginAs('staff1'); toastOuter('見本データに戻しました'); }
  });
  addEventListener('resize', () => {
    for (const id of ['siteScreen', 'staffScreen']) { const h = document.getElementById(id); h.style.setProperty('--screen-h', `${h.clientHeight}px`); }
  });

  resetDb();
  startSite();
  loginAs('staff1');
})();
