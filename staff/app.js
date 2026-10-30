// エキゾチックサプライ スタッフ用在庫アプリ
// 基本操作は「管理番号を打つ → 売約済みにする」の2アクション。押し間違いはトーストの「取り消す」で戻せる。
(() => {
  'use strict';
  const $app = document.getElementById('app');
  const $toast = document.getElementById('toast');
  const STATUS = { available: '販売中', sold: '売約済み', hidden: '非公開' };
  const SEX = ['', 'オス', 'メス', 'ペア', '不明'];
  const SEX_MARK = { オス: '♂', メス: '♀', ペア: '♂♀', 不明: '性別不明' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yen = (it) => (it.price_ask ? 'ASK' : it.price == null ? '価格未設定' : `¥${Number(it.price).toLocaleString('ja-JP')}`);
  const PH = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M14 40c6-10 16-14 26-12 6 1 10 5 12 9-4-2-8-2-11 0 3 1 5 3 6 6-6-3-13-3-19 0-5 2-10 2-14-3z" fill="#2f5a43" opacity=".35"/></svg>');

  const state = { me: null, categories: [], tab: 'sell', items: new Map(), stats: null, listFilter: 'available', listQuery: '' };
  const isOwner = () => state.me?.role === 'owner';

  // ---------- 通信 ----------
  async function api(path, { method = 'GET', body, form } = {}) {
    const res = await fetch(`/api${path}`, {
      method,
      headers: { 'X-Requested-With': 'es-staff', ...(body && { 'Content-Type': 'application/json' }) },
      body: form || (body && JSON.stringify(body)),
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/login') { state.me = null; renderLogin(); }
    if (!res.ok) throw Object.assign(new Error(data.error || '通信に失敗しました'), { status: res.status });
    return data;
  }
  const remember = (it) => { state.items.set(it.no, it); return it; };

  // ---------- トースト ----------
  let toastTimer;
  function toast(msg, { undo, error } = {}) {
    clearTimeout(toastTimer);
    $toast.className = `toast${error ? ' error' : ''}`;
    $toast.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">取り消す</button>' : ''}`;
    $toast.hidden = false;
    if (undo) $toast.querySelector('button').onclick = () => { $toast.hidden = true; undo(); };
    toastTimer = setTimeout(() => { $toast.hidden = true; }, undo ? 8000 : 3000);
  }

  // ---------- ステータス変更（楽観的更新） ----------
  async function changeStatus(no, status, { silent } = {}) {
    const it = state.items.get(no);
    const prev = it?.status;
    if (it) { it.status = status; refreshItem(no); }
    try {
      const { item } = await api(`/items/${encodeURIComponent(no)}/status`, { method: 'POST', body: { status } });
      remember(item);
      refreshItem(no);
      loadStats();
      if (!silent) {
        toast(`No.${no} を「${STATUS[status]}」にしました`, { undo: () => changeStatus(no, prev, { silent: true }).then(() => toast(`No.${no} を元に戻しました`)) });
      }
      if (state.tab === 'sell' && status === 'sold') {
        const input = document.getElementById('noInput');
        if (input) { input.value = ''; input.focus(); }
      }
    } catch (e) {
      if (it) { it.status = prev; refreshItem(no); }
      toast(e.message, { error: true });
    }
  }

  // ---------- 生体カード ----------
  function itemCard(it, { actions = true } = {}) {
    const sub = [it.morph, SEX_MARK[it.sex] || it.sex, it.size].filter(Boolean).join(' / ');
    let btns = '';
    if (actions) {
      btns = it.status === 'available'
        ? `<button class="act sell" data-act="sold" data-no="${esc(it.no)}">売約済みにする</button><button class="act sub" data-act="hidden" data-no="${esc(it.no)}">非公開</button>`
        : `<button class="act back" data-act="available" data-no="${esc(it.no)}">販売中に戻す</button>${it.status === 'sold' ? `<button class="act sub" data-act="hidden" data-no="${esc(it.no)}">非公開</button>` : ''}`;
    }
    return `<div class="item" id="item-${esc(it.no)}" data-open="${esc(it.no)}">
      <img class="ph" src="${esc(it.photos[0] || PH)}" alt="" loading="lazy">
      <div class="item-main">
        <div class="item-head"><span class="item-no">No.${esc(it.no)}</span><span class="pill ${it.status}">${STATUS[it.status]}</span></div>
        <div class="item-name">${esc(it.species)}</div>
        <div class="item-sub">${esc(sub)}${sub ? ' ・ ' : ''}${esc(yen(it))}</div>
      </div>
      ${btns ? `<div class="item-actions">${btns}</div>` : ''}
    </div>`;
  }
  function refreshItem(no) {
    const el = document.getElementById(`item-${no}`);
    const it = state.items.get(no);
    if (!el || !it) return;
    // 「販売中のみ」などの絞り込み表示中なら、条件外になった行は消さずに残しておく（取り消しやすいように）
    el.outerHTML = itemCard(it);
  }

  // ---------- 画面の枠 ----------
  const ICONS = {
    sell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h10M4 17h7"/><path d="m15 16 2 2 4-4"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    import: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  };
  function shell(content) {
    const tabs = [['sell', '売約登録'], ['list', '在庫'], ...(isOwner() ? [['import', '取り込み']] : []), ['more', 'その他']];
    const s = state.stats;
    $app.innerHTML = `
      <header class="top">
        <div class="top-row"><h1>ES在庫</h1><span class="who">${esc(state.me.name)}（${isOwner() ? '店主' : 'スタッフ'}）</span></div>
        <div class="stats">
          <div class="stat"><b id="stAvail">${s ? s.available : '–'}</b><span>販売中</span></div>
          <div class="stat"><b id="stSold">${s ? s.soldToday : '–'}</b><span>本日の売約</span></div>
          <div class="stat"><b id="stHidden">${s ? s.hidden : '–'}</b><span>非公開</span></div>
        </div>
      </header>
      <main id="main">${content}</main>
      <nav class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}"${state.tab === k ? ' aria-current="page"' : ''}>${ICONS[k]}<span>${l}</span></button>`).join('')}</nav>`;
  }
  async function loadStats() {
    try {
      state.stats = await api('/stats');
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('stAvail', state.stats.available); set('stSold', state.stats.soldToday); set('stHidden', state.stats.hidden);
    } catch { /* 表示だけなので無視 */ }
  }

  function go(tab) {
    state.tab = tab;
    ({ sell: renderSell, list: renderList, import: renderImport, more: renderMore })[tab]();
  }

  // ---------- 売約登録（メイン） ----------
  function renderSell() {
    shell(`
      <div class="no-input">
        <input id="noInput" type="text" inputmode="numeric" autocomplete="off" enterkeyhint="search" placeholder="管理番号" aria-label="管理番号">
        <button class="clear" type="button" id="clearNo" aria-label="消す">×</button>
      </div>
      <p class="hint">管理番号を入力すると候補が出ます。種名でも探せます。</p>
      <div class="list" id="results"></div>`);
    const input = document.getElementById('noInput');
    const results = document.getElementById('results');
    let seq = 0, t;
    const search = async () => {
      const q = input.value.trim().normalize('NFKC');
      const my = ++seq;
      if (!q) { results.innerHTML = ''; return; }
      try {
        const { items } = await api(`/items?q=${encodeURIComponent(q)}&limit=20`);
        if (my !== seq) return;
        items.forEach(remember);
        results.innerHTML = items.length ? items.map((i) => itemCard(i)).join('') : `<p class="empty">「${esc(q)}」に一致する在庫がありません</p>`;
      } catch (e) { results.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
    };
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 120); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(t); search(); input.blur(); } });
    document.getElementById('clearNo').onclick = () => { input.value = ''; results.innerHTML = ''; input.focus(); };
    input.focus();
    loadStats();
  }

  // ---------- 在庫一覧 ----------
  async function renderList() {
    const f = state.listFilter;
    shell(`
      <input class="search" id="listQ" type="search" placeholder="管理番号・種名で検索" value="${esc(state.listQuery)}">
      <div class="seg">${[['available', '販売中'], ['sold', '売約済み'], ['hidden', '非公開'], ['', 'すべて']].map(([k, l]) => `<button data-filter="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>
      ${isOwner() ? '<button class="btn" id="newItem" style="margin-bottom:12px">＋ 生体を新規登録</button>' : ''}
      <div class="list" id="listBox"><p class="empty">読み込み中…</p></div>`);
    const q = document.getElementById('listQ');
    let t;
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.listQuery = q.value.trim(); loadList(); }, 200); });
    document.getElementById('newItem')?.addEventListener('click', () => openEditor(null));
    loadList();
    loadStats();
  }
  async function loadList() {
    const box = document.getElementById('listBox');
    if (!box) return;
    try {
      const { items } = await api(`/items?status=${state.listFilter}&q=${encodeURIComponent(state.listQuery)}&limit=300`);
      items.forEach(remember);
      box.innerHTML = items.length ? items.map((i) => itemCard(i)).join('') : '<p class="empty">該当する在庫はありません</p>';
    } catch (e) { box.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
  }

  // ---------- 生体の詳細・編集シート ----------
  function closeSheet() { document.querySelector('.sheet-back')?.remove(); }
  function sheet(title, inner) {
    closeSheet();
    const back = document.createElement('div');
    back.className = 'sheet-back';
    back.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(title)}"><div class="sheet-grip"></div><div class="sheet-head"><h2>${esc(title)}</h2><button class="x" data-close aria-label="閉じる">×</button></div>${inner}</div>`;
    back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) closeSheet(); });
    document.body.appendChild(back);
    return back.querySelector('.sheet');
  }

  async function openEditor(no) {
    let it = no ? state.items.get(no) : null;
    if (no) { try { it = remember((await api(`/items/${encodeURIComponent(no)}`)).item); } catch (e) { return toast(e.message, { error: true }); } }
    if (!isOwner()) {
      const rows = [['種類', it.category], ['モルフ', it.morph], ['性別', it.sex], ['サイズ', it.size], ['CB/WB', it.origin], ['ハッチ日', it.birth], ['入荷日', it.arrived_at], ['価格', yen(it)], ['備考', it.note]].filter(([, v]) => v);
      const el = sheet(`No.${it.no} ${it.species}`, `
        ${it.photos[0] ? `<img src="${esc(it.photos[0])}" alt="" style="border-radius:12px;margin-bottom:12px;width:100%;aspect-ratio:1;object-fit:cover">` : ''}
        <div class="card">${rows.map(([k, v]) => `<div class="field"><span>${k}</span>${esc(v)}</div>`).join('')}
        <p class="locked">※ 価格・生体情報の変更は店主のみ可能です</p></div>
        <div class="list">${itemCard(it).replace(/id="item-[^"]*"/, '')}</div>`);
      el.addEventListener('click', (e) => { if (e.target.closest('[data-act]')) closeSheet(); });
      return;
    }
    const nextNo = it ? it.no : (await api('/next-no').catch(() => ({ no: '' }))).no;
    const v = it || { no: nextNo, category: '', species: '', morph: '', sex: '', size: '', origin: '', birth: '', arrived_at: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), price: '', price_ask: false, status: 'available', note: '', photos: [] };
    const photos = [...v.photos];
    const cats = [...new Set([...state.categories, v.category].filter(Boolean))];
    const el = sheet(it ? `No.${it.no} を編集` : '生体を新規登録', `
      <form id="edit" autocomplete="off">
        <div class="card">
          <div class="row2">
            <label class="field"><span>管理番号</span><input name="no" value="${esc(v.no)}" inputmode="numeric" required></label>
            <label class="field"><span>ステータス</span><select name="status">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${k === v.status ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          </div>
          <label class="field"><span>種名 *</span><input name="species" value="${esc(v.species)}" required></label>
          <label class="field"><span>モルフ</span><input name="morph" value="${esc(v.morph)}"></label>
          <div class="row2">
            <label class="field"><span>種類</span><select name="category"><option value="">—</option>${cats.map((c) => `<option${c === v.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
            <label class="field"><span>性別</span><select name="sex">${[...new Set([...SEX, v.sex])].map((s) => `<option value="${esc(s)}"${s === v.sex ? ' selected' : ''}>${s || '—'}</option>`).join('')}</select></label>
          </div>
          <div class="row2">
            <label class="field"><span>サイズ</span><input name="size" value="${esc(v.size)}" placeholder="ベビー / 15cm"></label>
            <label class="field"><span>CB/WB・産地</span><input name="origin" value="${esc(v.origin)}"></label>
          </div>
          <div class="row2">
            <label class="field"><span>ハッチ日</span><input name="birth" value="${esc(v.birth)}" placeholder="2026-06-01"></label>
            <label class="field"><span>入荷日</span><input name="arrived_at" type="date" value="${esc(v.arrived_at)}"></label>
          </div>
        </div>
        <div class="card">
          <h2>価格</h2>
          <label class="field"><span>税込価格（円）</span><input name="price" type="number" inputmode="numeric" min="0" step="1" value="${v.price ?? ''}"></label>
          <label class="check"><input type="checkbox" name="price_ask"${v.price_ask ? ' checked' : ''}> 価格を公開しない（ASK表示）</label>
        </div>
        <div class="card">
          <h2>写真</h2>
          <div class="photos" id="photos"></div>
          <p class="note">${it ? '1枚目がサイトの一覧に表示されます。' : '写真は登録後に追加できます。'}</p>
        </div>
        <div class="card"><label class="field"><span>備考（サイトに表示されます）</span><textarea name="note">${esc(v.note)}</textarea></label></div>
        <p class="err" id="editErr"></p>
        <button class="btn" type="submit">${it ? '保存する' : '登録する'}</button>
        ${it ? '<button class="btn danger" type="button" id="del">この生体を削除</button>' : ''}
      </form>`);
    const box = el.querySelector('#photos');
    const drawPhotos = () => {
      box.innerHTML = photos.map((p, i) => `<div class="ph"><img src="${esc(p)}" alt=""><button type="button" data-rm="${i}" aria-label="削除">×</button></div>`).join('')
        + (it ? '<label class="add">＋<br>写真<input type="file" accept="image/*" hidden id="photoIn"></label>' : '');
      box.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { photos.splice(Number(b.dataset.rm), 1); drawPhotos(); }; });
      box.querySelector('#photoIn')?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          toast('写真をアップロード中…');
          const form = new FormData();
          form.append('photo', await shrink(file), 'photo.jpg');
          const { item } = await api(`/items/${encodeURIComponent(it.no)}/photos`, { method: 'POST', form });
          remember(item);
          photos.splice(0, photos.length, ...item.photos);
          drawPhotos();
          toast('写真を追加しました');
        } catch (err) { toast(err.message, { error: true }); }
      });
    };
    drawPhotos();
    el.querySelector('#edit').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      body.price_ask = fd.has('price_ask');
      body.photos = photos;
      try {
        const { item } = it ? await api(`/items/${encodeURIComponent(it.no)}`, { method: 'PATCH', body }) : await api('/items', { method: 'POST', body });
        remember(item);
        closeSheet();
        toast(it ? `No.${item.no} を保存しました` : `No.${item.no} を登録しました`);
        if (state.tab === 'list') loadList();
        loadStats();
      } catch (err) { el.querySelector('#editErr').textContent = err.message; }
    });
    el.querySelector('#del')?.addEventListener('click', async () => {
      if (!confirm(`No.${it.no}（${it.species}）を削除します。元に戻せません。よろしいですか？\n※売れた場合は削除せず「売約済み」にしてください。`)) return;
      try { await api(`/items/${encodeURIComponent(it.no)}`, { method: 'DELETE' }); state.items.delete(it.no); closeSheet(); toast('削除しました'); loadList(); loadStats(); }
      catch (err) { toast(err.message, { error: true }); }
    });
  }

  // スマホの写真は大きいので、送る前に縮小して通信量と待ち時間を減らす
  async function shrink(file, max = 1600) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    } catch { return file; }
  }

  // ---------- 取り込み（店主） ----------
  let preview = null;
  function renderImport() {
    shell(`
      <div class="card">
        <h2>リストの取り込み</h2>
        <p class="note">Excel（.xlsx）・CSV・テキストファイル、またはブログの文章をそのまま貼り付けて読み込めます。取り込む前に内容を確認できます。管理番号が同じ生体は上書きされます。</p>
        <label class="field"><span>ファイルを選ぶ</span><input type="file" id="impFile" accept=".xlsx,.csv,.tsv,.txt,text/plain,text/csv"></label>
        <label class="field"><span>または文章を貼り付け</span><textarea id="impText" placeholder="No.101 ヒョウモントカゲモドキ ハイポタンジェリン ♂ ベビー 12,800円"></textarea></label>
        <p class="err" id="impErr"></p>
        <button class="btn" id="impPreview">読み込んで確認する</button>
      </div>
      <div id="impResult"></div>`);
    document.getElementById('impPreview').onclick = async () => {
      const file = document.getElementById('impFile').files[0];
      const text = document.getElementById('impText').value;
      const form = new FormData();
      if (file) form.append('file', file); else form.append('text', text);
      const err = document.getElementById('impErr');
      err.textContent = '';
      try { preview = await api('/import/preview', { method: 'POST', form }); drawPreview(); }
      catch (e) { err.textContent = e.message; }
    };
  }
  function drawPreview() {
    const box = document.getElementById('impResult');
    const rows = preview.rows;
    const nNew = rows.filter((r) => !r._exists).length;
    box.innerHTML = `
      <div class="card">
        <h2>${rows.length}件を読み取りました（新規 ${nNew}・上書き ${rows.length - nNew}）</h2>
        ${preview.warnings.map((w) => `<p class="note">⚠ ${esc(w)}</p>`).join('')}
        <label class="field"><span>新規の生体の公開状態</span><select id="impStatus"><option value="available">すぐ公開（販売中）</option><option value="hidden">非公開で取り込む（あとで確認して公開）</option></select></label>
      </div>
      <div class="prev">${rows.map((r, i) => `
        <label class="prev-row"><input type="checkbox" data-i="${i}" checked>
          <div><span class="tag ${r._exists ? 'upd' : 'new'}">${r._exists ? '上書き' : '新規'}</span><b>${r.no ? `No.${esc(r.no)}` : '番号自動'}</b> ${esc(r.species || '（種名なし）')} ${esc(r.morph || '')}<br>
          <small>${esc([r.category, r.sex, r.size, r.origin, r.birth && `ハッチ ${r.birth}`].filter(Boolean).join(' / '))} ・ <b>${r.price_ask ? 'ASK' : r.price != null ? `¥${Number(r.price).toLocaleString()}` : '価格なし'}</b>${r.status ? ` ・ ${STATUS[r.status]}` : ''}${r.photos?.length ? ` ・ 写真${r.photos.length}枚` : ''}</small>
          ${r._warnings.length ? `<div class="w">⚠ ${esc(r._warnings.join('／'))}</div>` : ''}</div>
        </label>`).join('')}</div>
      <p class="err" id="commitErr"></p>
      <button class="btn" id="impCommit" style="margin-top:12px">チェックした行を取り込む</button>`;
    document.getElementById('impCommit').onclick = async () => {
      const chosen = [...box.querySelectorAll('input[data-i]:checked')].map((c) => rows[Number(c.dataset.i)]).filter((r) => r.species);
      if (!chosen.length) return (document.getElementById('commitErr').textContent = '取り込む行を選んでください（種名のない行は取り込めません）');
      try {
        const r = await api('/import/commit', { method: 'POST', body: { rows: chosen, newStatus: document.getElementById('impStatus').value } });
        preview = null;
        box.innerHTML = `<div class="card"><h2>取り込みが完了しました</h2><p>新規 ${r.created}件・上書き ${r.updated}件${r.errors.length ? `・エラー ${r.errors.length}件` : ''}</p>${r.errors.map((e) => `<p class="note">⚠ ${esc(e.no ? `No.${e.no}` : `${e.row}行目`)}：${esc(e.message)}</p>`).join('')}</div>`;
        document.getElementById('impText').value = '';
        document.getElementById('impFile').value = '';
        loadStats();
      } catch (e) { document.getElementById('commitErr').textContent = e.message; }
    };
  }

  // ---------- その他 ----------
  function renderMore() {
    shell(`
      <div class="menu">
        ${isOwner() ? '<button data-more="users">スタッフ管理</button><button data-more="settings">店舗情報・サイト設定</button><button data-more="logs">変更履歴</button>' : ''}
        <button data-more="install">アプリをホーム画面に追加する方法</button>
        <button data-more="site">公開サイトを見る</button>
        <button data-more="logout">ログアウト</button>
      </div>`);
  }
  const moreActions = {
    site: () => window.open('/', '_blank'),
    logout: async () => { if (!confirm('ログアウトしますか？')) return; await api('/logout', { method: 'POST' }).catch(() => {}); state.me = null; renderLogin(); },
    install: () => sheet('ホーム画面に追加', `<div class="card">
      <h2>iPhone（Safari）</h2><p>画面下の共有ボタン（□に↑）→「ホーム画面に追加」→「追加」。</p>
      <h2>Android（Chrome）</h2><p>右上の︙ →「アプリをインストール」または「ホーム画面に追加」。</p>
      <p class="note">追加後はホーム画面の「ES在庫」アイコンから開けます。ログインは一度だけで、しばらくは自動でログインされた状態になります。</p></div>`),
    logs: async () => {
      const el = sheet('変更履歴（最新200件）', '<p class="empty">読み込み中…</p>');
      const { logs } = await api('/logs');
      const label = (l) => {
        if (l.action === 'status') return `${STATUS[l.detail.from]} → <b>${STATUS[l.detail.to]}</b>`;
        if (l.action === 'price') return `価格変更 ${esc(fmtChange(l.detail.price, l.detail.price_ask))}`;
        return { create: '新規登録', edit: '情報を編集', delete: '削除' }[l.action] || esc(l.action);
      };
      el.querySelector('.empty').outerHTML = logs.map((l) => `<div class="log"><time>${esc(fmtTime(l.at))}</time><b>${esc(l.user_name)}</b>：No.${esc(l.item_no)} ${label(l)}</div>`).join('') || '<p class="empty">履歴はまだありません</p>';
    },
    users: async () => {
      const el = sheet('スタッフ管理', '<div id="users"><p class="empty">読み込み中…</p></div>');
      const draw = async () => {
        const { users, limits } = await api('/users');
        const act = (r) => users.filter((u) => u.role === r && u.active).length;
        el.querySelector('#users').innerHTML = `
          <div class="card"><p class="note">店主（価格の変更ができる人）：${act('owner')} / ${limits.owner}名　スタッフ：${act('staff')} / ${limits.staff}名</p>
          ${users.map((u) => `<div class="user-row"><div><b>${esc(u.name)}</b> <small>ID: ${esc(u.login)}・${u.role === 'owner' ? '店主' : 'スタッフ'}${u.active ? '' : '・停止中'}</small></div>
            <div style="display:flex;gap:6px"><button class="act sub" data-pw="${u.id}">PW変更</button><button class="act sub" data-toggle="${u.id}" data-active="${u.active}">${u.active ? '停止' : '再開'}</button></div></div>`).join('')}</div>
          <form class="card" id="addUser" autocomplete="off"><h2>アカウントを追加</h2>
            <div class="row2"><label class="field"><span>表示名</span><input name="name" required placeholder="山田"></label>
            <label class="field"><span>権限</span><select name="role"><option value="staff">スタッフ</option><option value="owner">店主（価格変更可）</option></select></label></div>
            <div class="row2"><label class="field"><span>ログインID（半角英数）</span><input name="login" required autocapitalize="off" placeholder="yamada"></label>
            <label class="field"><span>パスワード（6文字以上）</span><input name="password" required minlength="6"></label></div>
            <p class="err" id="uErr"></p><button class="btn">追加する</button></form>`;
        el.querySelector('#addUser').onsubmit = async (e) => {
          e.preventDefault();
          try { await api('/users', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('アカウントを追加しました'); draw(); }
          catch (err) { el.querySelector('#uErr').textContent = err.message; }
        };
        el.querySelectorAll('[data-toggle]').forEach((b) => { b.onclick = async () => {
          try { await api(`/users/${b.dataset.toggle}`, { method: 'PATCH', body: { active: b.dataset.active !== '1' } }); draw(); } catch (err) { toast(err.message, { error: true }); }
        }; });
        el.querySelectorAll('[data-pw]').forEach((b) => { b.onclick = async () => {
          const pw = prompt('新しいパスワード（6文字以上）');
          if (!pw) return;
          try { await api(`/users/${b.dataset.pw}`, { method: 'PATCH', body: { password: pw } }); toast('パスワードを変更しました'); } catch (err) { toast(err.message, { error: true }); }
        }; });
      };
      draw();
    },
    settings: async () => {
      const { settings: s } = await api('/settings');
      const f = (k, label, type = 'text', ph = '') => type === 'area'
        ? `<label class="field"><span>${label}</span><textarea name="${k}" placeholder="${esc(ph)}">${esc(s[k])}</textarea></label>`
        : `<label class="field"><span>${label}</span><input name="${k}" type="${type}" value="${esc(s[k])}" placeholder="${esc(ph)}"></label>`;
      const el = sheet('店舗情報・サイト設定', `<form id="setForm">
        <div class="card"><h2>店舗情報</h2>${f('shopName', '店名')}${f('tagline', 'キャッチコピー')}${f('address', '住所', 'area')}${f('hours', '営業時間', 'area', '12:00〜20:00')}${f('holidays', '定休日')}
          ${f('phone', '電話番号', 'tel')}${f('lineUrl', 'LINE 友だち追加URL', 'url', 'https://lin.ee/xxxx')}${f('lineId', 'LINE ID（表示用）')}${f('mapUrl', 'Googleマップ埋め込みURL', 'url')}</div>
        <div class="card"><h2>お知らせ・イベント</h2>${f('notice', 'サイト上部のお知らせ（空欄で非表示）')}${f('eventInfo', 'イベント出店情報', 'area')}</div>
        <div class="card"><h2>第一種動物取扱業の表示</h2>${f('bizName', '氏名又は名称')}${f('regType', '種別')}${f('regNo', '登録番号')}${f('regDate', '登録年月日')}${f('regExpiry', '有効期間の末日')}${f('manager', '動物取扱責任者')}</div>
        <div class="card"><h2>表示ルール</h2>${f('newDays', '「新着」として表示する日数', 'number')}${f('soldVisibleDays', '売約済みをサイトに残す日数', 'number')}
          <label class="field"><span>種類（カンマ区切り）</span><input name="categories" value="${esc(s.categories.join(','))}"></label></div>
        <p class="err" id="sErr"></p><button class="btn">保存する</button></form>`);
      el.querySelector('#setForm').onsubmit = async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target));
        body.newDays = Number(body.newDays) || 14;
        body.soldVisibleDays = Number(body.soldVisibleDays) || 0;
        body.categories = body.categories.split(/[,、]/).map((c) => c.trim()).filter(Boolean);
        try { const r = await api('/settings', { method: 'PUT', body }); state.categories = r.settings.categories; closeSheet(); toast('保存しました（サイトに反映されました）'); }
        catch (err) { el.querySelector('#sErr').textContent = err.message; }
      };
    },
  };
  const fmtTime = (at) => new Date(`${at.replace(' ', 'T')}Z`).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
  const fmtChange = (p, a) => {
    const v = (x, ask) => (ask ? 'ASK' : x == null || x === '' ? '未設定' : `¥${Number(x).toLocaleString()}`);
    const from = v(p ? p.from : null, a ? a.from : null), to = v(p ? p.to : null, a ? a.to : null);
    return p || a ? `${from} → ${to}` : '';
  };

  // ---------- ログイン ----------
  async function renderLogin() {
    let setup = false;
    try { setup = (await api('/setup-needed')).needed; } catch {}
    $app.innerHTML = `<div class="login"><form class="card" id="loginForm" autocomplete="on">
      <div class="logo"><img src="/img/icon.svg" alt=""><div><b>ES在庫</b><div class="note">エキゾチックサプライ 在庫管理</div></div></div>
      ${setup ? '<p class="note">最初の店主アカウントを作成してください。</p><label class="field"><span>表示名</span><input name="name" required></label>' : ''}
      <label class="field"><span>ログインID</span><input name="login" required autocapitalize="off" autocomplete="username"></label>
      <label class="field"><span>パスワード</span><input name="password" type="password" required autocomplete="${setup ? 'new-password' : 'current-password'}"></label>
      <p class="err" id="lErr"></p>
      <button class="btn">${setup ? '作成してはじめる' : 'ログイン'}</button></form></div>`;
    document.getElementById('loginForm').onsubmit = async (e) => {
      e.preventDefault();
      try { await api(setup ? '/setup' : '/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); boot(); }
      catch (err) { document.getElementById('lErr').textContent = err.message; }
    };
  }

  // ---------- 共通のクリック処理 ----------
  document.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (act) { e.stopPropagation(); return changeStatus(act.dataset.no, act.dataset.act); }
    const tab = e.target.closest('[data-tab]');
    if (tab) return go(tab.dataset.tab);
    const filter = e.target.closest('[data-filter]');
    if (filter) { state.listFilter = filter.dataset.filter; return renderList(); }
    const more = e.target.closest('[data-more]');
    if (more) return moreActions[more.dataset.more]?.();
    const open = e.target.closest('[data-open]');
    if (open && !e.target.closest('.sheet')) return openEditor(open.dataset.open);
  });

  // ---------- 他のスタッフの操作をリアルタイムで反映 ----------
  function listen() {
    const es = new EventSource('/events');
    es.addEventListener('item', async (e) => {
      const d = JSON.parse(e.data);
      const known = state.items.get(d.no);
      if (known && d.status !== 'deleted' && known.updated_at !== d.updated_at) {
        try { remember((await api(`/items/${encodeURIComponent(d.no)}`)).item); refreshItem(d.no); document.getElementById(`item-${d.no}`)?.classList.add('flash'); } catch {}
      }
      loadStats();
    });
    es.addEventListener('reload', () => { loadStats(); if (state.tab === 'list') loadList(); });
  }

  const setOnline = () => { document.getElementById('offline').hidden = navigator.onLine; };
  addEventListener('online', setOnline);
  addEventListener('offline', setOnline);

  async function boot() {
    setOnline();
    try {
      const me = await api('/me');
      state.me = me.user;
      state.categories = me.categories;
      go(state.tab === 'import' && !isOwner() ? 'sell' : state.tab);
      if (!boot.listening) { listen(); boot.listening = true; }
    } catch (e) {
      if (e.status !== 401) $app.innerHTML = `<div class="boot">${esc(e.message)}<br><button class="btn ghost" onclick="location.reload()">再読み込み</button></div>`;
    }
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/staff/sw.js', { scope: '/staff/' }).catch(() => {});
  boot();
})();
