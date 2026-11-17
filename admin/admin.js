// エキゾチックサプライ 店主のパソコン画面
// 在庫を表で一覧し、価格・状態はその場で変更、複数選んでまとめて変更できる。データはスタッフアプリと同じ API を使う。
(() => {
  'use strict';
  const $root = document.getElementById('admin');
  const $toast = document.getElementById('toast');
  const STATUS = { available: '販売中', sold: '売約済み', done: '販売済み', hidden: '非公開' };
  const SEX = ['', 'オス', 'メス', 'ペア', '不明'];
  const PAGE = 100;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yen = (n) => `¥${Number(n).toLocaleString('ja-JP')}`;
  const jstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const fmtTime = (at) => new Date(`${String(at).replace(' ', 'T')}Z`).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });

  const state = {
    me: null, categories: [], items: new Map(), view: 'stock',
    filter: { status: 'available', category: '', q: '' }, sort: { key: 'arrived_at', dir: -1 }, page: 1, selected: new Set(),
  };

  // ---------- 通信 ----------
  async function api(path, { method = 'GET', body, form } = {}) {
    let res;
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers: { 'X-Requested-With': 'es-staff', ...(body && { 'Content-Type': 'application/json' }) },
        body: form || (body && JSON.stringify(body)),
        credentials: 'same-origin',
      });
    } catch { throw new Error('サーバーにつながりません。ネット接続を確認してください'); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/login') { state.me = null; renderLogin(); }
    if (!res.ok) throw Object.assign(new Error(data.error || '通信に失敗しました'), { status: res.status });
    return data;
  }
  async function loadAll() {
    const { items } = await api('/items?limit=100000');
    state.items = new Map(items.map((i) => [i.no, i]));
  }

  let toastTimer;
  function toast(msg, { error, undo } = {}) {
    clearTimeout(toastTimer);
    $toast.className = `toast${error ? ' error' : ''}`;
    $toast.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">取り消す</button>' : ''}`;
    $toast.hidden = false;
    if (undo) $toast.querySelector('button').onclick = () => { $toast.hidden = true; undo(); };
    toastTimer = setTimeout(() => { $toast.hidden = true; }, undo ? 8000 : 3200);
  }

  // ブラウザにファイルとして保存（CSV 書き出し）
  function saveFile(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- 画面の枠 ----------
  const NAV = [['stock', '在庫一覧'], ['new', '生体を登録'], ['import', 'リストの取り込み'], ['settings', '店舗情報・サイト設定'], ['users', 'スタッフ管理'], ['logs', '変更履歴']];
  function shell(content) {
    const counts = countBy();
    $root.innerHTML = `<div class="shell">
      <nav class="side" aria-label="メニュー">
        <div class="brand"><img src="/img/icon.svg" alt=""><div><b>エキゾチックサプライ</b><small>店主画面</small></div></div>
        ${NAV.map(([k, l]) => `<button type="button" data-view="${k}"${state.view === k ? ' aria-current="page"' : ''}>${l}${k === 'stock' ? `<span class="count">${counts.available}</span>` : ''}</button>`).join('')}
        <div class="spacer"></div>
        <a href="/" target="_blank" rel="noopener">公開サイトを見る ↗</a>
        <button type="button" data-logout>ログアウト</button>
        <p class="who">${esc(state.me.name)} でログイン中</p>
      </nav>
      <main class="main" id="main">${content}</main>
    </div>`;
  }
  function go(view) {
    state.view = view;
    if (view === 'new') return openEditor(null);
    ({ stock: renderStock, import: renderImport, settings: renderSettings, users: renderUsers, logs: renderLogs })[view]();
  }

  function countBy(category) {
    const c = { available: 0, sold: 0, done: 0, hidden: 0, all: 0 };
    for (const it of state.items.values()) {
      if (category && it.category !== category) continue;
      c[it.status]++; c.all++;
    }
    return c;
  }

  // ---------- 在庫一覧（表） ----------
  function filtered() {
    const { status, category, q } = state.filter;
    const key = q.trim().normalize('NFKC').toLowerCase();
    let list = [...state.items.values()].filter((it) => (!status || it.status === status) && (!category || it.category === category)
      && (!key || String(it.no).toLowerCase() === key || String(it.no).toLowerCase().startsWith(key) || String(it.pub_id).toLowerCase() === key
        || `${it.species} ${it.morph}`.normalize('NFKC').toLowerCase().includes(key)));
    const { key: sk, dir } = state.sort;
    const val = (it) => (sk === 'no' ? (/^\d+$/.test(it.no) ? Number(it.no) : it.no) : sk === 'price' ? (it.price_ask ? Infinity : it.price ?? -1) : it[sk] ?? '');
    list.sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * dir || String(b.updated_at).localeCompare(String(a.updated_at)); });
    return list;
  }

  function renderStock() {
    const counts = countBy(state.filter.category);
    const cats = [...new Set([...state.categories, ...[...state.items.values()].map((i) => i.category).filter(Boolean)])];
    const { status, category, q } = state.filter;
    shell(`
      <div class="page-head"><h1>在庫一覧</h1>
        <div class="actions"><button type="button" class="btn" data-csv>CSVで書き出す</button><button type="button" class="btn primary" data-view="new">＋ 生体を登録</button></div>
      </div>
      <div class="toolbar">
        <input type="search" id="q" placeholder="管理番号・お問い合わせコード・種名・モルフで検索" value="${esc(q)}" aria-label="検索">
        <select id="cat" aria-label="分類"><option value="">すべての分類</option>${cats.map((c) => `<option${c === category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <div class="tabs">${[['available', '販売中'], ['sold', '売約済み'], ['done', '販売済み'], ['hidden', '非公開'], ['', 'すべて']]
          .map(([k, l]) => `<button type="button" data-status="${k}" aria-pressed="${status === k}">${l}<b>${k ? counts[k] : counts.all}</b></button>`).join('')}</div>
      </div>
      <div id="bulk"></div>
      <div id="tableBox"></div>`);
    const qi = document.getElementById('q');
    let t;
    qi.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.filter.q = qi.value; state.page = 1; drawTable(); }, 120); });
    document.getElementById('cat').addEventListener('change', (e) => { state.filter.category = e.target.value; state.page = 1; renderStock(); });
    drawTable();
  }

  function drawTable() {
    const box = document.getElementById('tableBox');
    if (!box) return;
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    state.page = Math.min(state.page, pages);
    const rows = list.slice((state.page - 1) * PAGE, state.page * PAGE);
    const { key: sk, dir } = state.sort;
    const th = (key, label) => `<th data-sort="${key}">${label}${sk === key ? `<span class="arrow">${dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`;
    const allOnPage = rows.length && rows.every((r) => state.selected.has(r.no));
    box.innerHTML = rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th><input type="checkbox" data-selall${allOnPage ? ' checked' : ''} aria-label="このページをすべて選択"></th>
        ${th('no', '管理番号')}<th>写真</th>${th('species', '種名・モルフ')}${th('category', '分類')}<th>性別・サイズ</th>${th('arrived_at', '入荷日')}${th('status', '状態')}${th('price', '価格（税込）')}<th>コード</th><th></th></tr></thead>
      <tbody>${rows.map(rowHtml).join('')}</tbody></table></div>
      <div class="pager"><span>${list.length}件中 ${(state.page - 1) * PAGE + 1}〜${Math.min(state.page * PAGE, list.length)}件</span>
        <div class="btns"><button type="button" class="btn" data-page="-1"${state.page <= 1 ? ' disabled' : ''}>‹ 前へ</button><span>${state.page} / ${pages}</span><button type="button" class="btn" data-page="1"${state.page >= pages ? ' disabled' : ''}>次へ ›</button></div></div>`
      : '<div class="table-wrap"><p class="empty">条件に合う生体はありません</p></div>';
    drawBulk();
  }

  function rowHtml(it) {
    return `<tr data-row="${esc(it.no)}"${state.selected.has(it.no) ? ' class="is-selected"' : ''}>
      <td><input type="checkbox" data-sel="${esc(it.no)}"${state.selected.has(it.no) ? ' checked' : ''} aria-label="No.${esc(it.no)} を選択"></td>
      <td class="num">${esc(it.no)}</td>
      <td>${it.photos?.[0] ? `<img class="ph" src="${esc(it.photos[0])}" alt="" loading="lazy">` : '<span class="ph"></span>'}</td>
      <td class="name" data-edit="${esc(it.no)}" title="クリックで編集"><b>${esc(it.species)}</b>${it.morph ? `<small>${esc(it.morph)}</small>` : ''}</td>
      <td>${esc(it.category)}</td>
      <td>${esc([it.sex, it.size].filter(Boolean).join('・'))}</td>
      <td>${esc(it.arrived_at)}</td>
      <td><select class="status ${it.status}" data-st="${esc(it.no)}" aria-label="状態">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${k === it.status ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><div class="price-cell"><input type="number" min="0" step="100" value="${it.price ?? ''}" data-price="${esc(it.no)}"${it.price_ask ? ' disabled' : ''} aria-label="価格">
        <label><input type="checkbox" data-ask="${esc(it.no)}"${it.price_ask ? ' checked' : ''}>ASK</label></div></td>
      <td><span class="code">${esc(it.pub_id)}</span></td>
      <td><button type="button" class="rowbtn" data-edit="${esc(it.no)}">編集</button></td>
    </tr>`;
  }
  function refreshRow(no, flash) {
    const tr = document.querySelector(`tr[data-row="${CSS.escape(no)}"]`);
    const it = state.items.get(no);
    if (!tr) return;
    if (!it) { tr.remove(); return; }
    tr.outerHTML = rowHtml(it);
    if (flash) document.querySelector(`tr[data-row="${CSS.escape(no)}"]`)?.classList.add('flash');
  }

  function drawBulk() {
    const box = document.getElementById('bulk');
    if (!box) return;
    const n = [...state.selected].filter((no) => state.items.has(no)).length;
    if (!n) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="bulkbar"><b>${n}件を選択中</b>
      <select data-bulk="status" aria-label="状態をまとめて変更"><option value="">状態を変更…</option>${Object.entries(STATUS).map(([k, l]) => `<option value="${k}">${l}にする</option>`).join('')}</select>
      <select data-bulk="category" aria-label="分類をまとめて変更"><option value="">分類を変更…</option>${state.categories.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
      <button type="button" class="btn" data-bulkask="1">ASKにする</button><button type="button" class="btn" data-bulkask="0">ASKを外す</button>
      <button type="button" class="btn danger" data-bulkdel>削除</button>
      <button type="button" class="btn" data-clearsel>選択を解除</button></div>`;
  }

  async function bulk(action, value, label) {
    const nos = [...state.selected].filter((no) => state.items.has(no));
    if (action === 'delete' && !confirm(`${nos.length}件の生体を削除します。元に戻せません。\n売れた生体は削除せず「販売済み」にしてください。よろしいですか？`)) return;
    try {
      const r = await api('/items/bulk', { method: 'POST', body: { nos, action, value } });
      await loadAll();
      state.selected.clear();
      renderStock();
      toast(`${r.changed}件を${label}${r.errors.length ? `（${r.errors.length}件は変更できませんでした）` : ''}`);
    } catch (e) { toast(e.message, { error: true }); }
  }

  async function setStatus(no, status, { silent } = {}) {
    const it = state.items.get(no);
    const prev = it.status;
    try {
      const { item } = await api(`/items/${encodeURIComponent(no)}/status`, { method: 'POST', body: { status } });
      state.items.set(no, item);
      refreshRow(no);
      if (!silent) toast(`No.${no} を「${STATUS[status]}」にしました`, { undo: () => setStatus(no, prev, { silent: true }) });
    } catch (e) { toast(e.message, { error: true }); refreshRow(no); }
  }
  async function patch(no, body, msg) {
    try {
      const { item } = await api(`/items/${encodeURIComponent(no)}`, { method: 'PATCH', body });
      state.items.set(no, item);
      refreshRow(no);
      if (msg) toast(msg);
      return item;
    } catch (e) { toast(e.message, { error: true }); refreshRow(no); return null; }
  }

  function exportCsv() {
    const cols = [['no', '管理番号'], ['pub_id', 'お問い合わせコード'], ['category', '分類'], ['species', '種名'], ['morph', 'モルフ'], ['sex', '性別'], ['size', 'サイズ'],
      ['origin', 'CB/WB'], ['birth', 'ハッチ日'], ['arrived_at', '入荷日'], ['price', '価格'], ['status', '状態'], ['note', '備考']];
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [cols.map(([, l]) => cell(l)).join(',')].concat(filtered().map((it) => cols.map(([k]) =>
      cell(k === 'price' ? (it.price_ask ? 'ASK' : it.price ?? '') : k === 'status' ? STATUS[it.status] : it[k])).join(',')));
    // Excel で文字化けしないよう先頭に BOM を付ける
    saveFile(`在庫一覧_${jstToday()}.csv`, new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
    toast('CSVを書き出しました（読み込みのときもこの形式が使えます）');
  }

  // ---------- 生体の編集パネル ----------
  function closePanel() { document.querySelector('.panel-back')?.remove(); document.querySelector('.panel')?.remove(); if (state.view === 'new') { state.view = 'stock'; renderStock(); } }
  async function openEditor(no) {
    if (state.view === 'new' && !document.getElementById('tableBox')) { state.view = 'stock'; renderStock(); state.view = 'new'; }
    const it = no ? state.items.get(no) : null;
    const nextNo = it ? it.no : (await api('/next-no').catch(() => ({ no: '' }))).no;
    const v = it || { no: nextNo, category: '', species: '', morph: '', sex: '', size: '', origin: '', birth: '', arrived_at: jstToday(), price: '', price_ask: false, status: 'available', note: '', photos: [] };
    const photos = [...(v.photos || [])];
    const cats = [...new Set([...state.categories, v.category].filter(Boolean))];
    document.querySelector('.panel')?.remove();
    document.querySelector('.panel-back')?.remove();
    const back = document.createElement('div');
    back.className = 'panel-back';
    back.dataset.closepanel = '';
    const panel = document.createElement('aside');
    panel.className = 'panel';
    panel.setAttribute('aria-label', '生体の編集');
    panel.innerHTML = `<div class="panel-head"><h2>${it ? `No.${esc(it.no)} を編集` : '生体を登録'}</h2><button type="button" class="x" data-closepanel aria-label="閉じる">×</button></div>
      ${it ? `<p class="note">お問い合わせコード：<b>${esc(it.pub_id)}</b>（お客様に見える番号）</p>` : ''}
      <form id="edit" autocomplete="off">
        <div class="grid2">
          <label class="field"><span>管理番号</span><input name="no" value="${esc(v.no)}" required></label>
          <label class="field"><span>状態</span><select name="status">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${k === v.status ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>種名 *</span><input name="species" value="${esc(v.species)}" required></label>
        <label class="field"><span>モルフ</span><input name="morph" value="${esc(v.morph)}"></label>
        <div class="grid2">
          <label class="field"><span>分類（空欄なら種名から自動）</span><select name="category"><option value="">—</option>${cats.map((c) => `<option${c === v.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
          <label class="field"><span>性別</span><select name="sex">${[...new Set([...SEX, v.sex])].map((s) => `<option value="${esc(s)}"${s === v.sex ? ' selected' : ''}>${s || '—'}</option>`).join('')}</select></label>
          <label class="field"><span>サイズ</span><input name="size" value="${esc(v.size)}"></label>
          <label class="field"><span>CB/WB・産地</span><input name="origin" value="${esc(v.origin)}"></label>
          <label class="field"><span>ハッチ日</span><input name="birth" value="${esc(v.birth)}" placeholder="2026-06-01"></label>
          <label class="field"><span>入荷日</span><input name="arrived_at" type="date" value="${esc(v.arrived_at)}"></label>
          <label class="field"><span>税込価格（円）</span><input name="price" type="number" min="0" step="100" value="${v.price ?? ''}"></label>
          <label class="check" style="align-self:end"><input type="checkbox" name="price_ask"${v.price_ask ? ' checked' : ''}> 価格を公開しない（ASK）</label>
        </div>
        <label class="field"><span>備考（サイトに表示されます）</span><textarea name="note">${esc(v.note)}</textarea></label>
        <div class="field"><span>写真（1枚目がサイトの一覧に出ます）</span><div class="photos" id="photos"></div></div>
        <p class="err" id="editErr"></p>
        <div class="actions"><button class="btn primary" type="submit">${it ? '保存する' : '登録する'}</button>
          ${it ? '<button class="btn danger" type="button" id="del">この生体を削除</button>' : ''}</div>
      </form>`;
    document.body.append(back, panel);
    const box = panel.querySelector('#photos');
    const draw = () => {
      box.innerHTML = photos.map((p, i) => `<div class="ph"><img src="${esc(p)}" alt=""><button type="button" data-rm="${i}" aria-label="写真を外す">×</button></div>`).join('')
        + (it ? '<label>＋ 写真を追加<input type="file" accept="image/*" multiple hidden id="photoIn"></label>' : '<p class="note">写真は登録したあとに追加できます</p>');
      box.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { photos.splice(Number(b.dataset.rm), 1); draw(); }; });
      box.querySelector('#photoIn')?.addEventListener('change', async (e) => {
        for (const file of e.target.files) {
          try {
            const form = new FormData();
            form.append('photo', await shrink(file), 'photo.jpg');
            const { item } = await api(`/items/${encodeURIComponent(it.no)}/photos`, { method: 'POST', form });
            state.items.set(item.no, item);
            photos.splice(0, photos.length, ...item.photos);
            draw();
          } catch (err) { toast(err.message, { error: true }); }
        }
        refreshRow(it.no);
      });
    };
    draw();
    panel.querySelector('#edit').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      body.price_ask = fd.has('price_ask');
      body.photos = photos;
      try {
        const { item } = it ? await api(`/items/${encodeURIComponent(it.no)}`, { method: 'PATCH', body }) : await api('/items', { method: 'POST', body });
        if (it && item.no !== it.no) state.items.delete(it.no);
        state.items.set(item.no, item);
        toast(it ? `No.${item.no} を保存しました` : `No.${item.no} を登録しました`);
        if (it) { closePanel(); drawTable(); } else { openEditor(null); drawTable(); } // 新規は続けて登録できるように
      } catch (err) { panel.querySelector('#editErr').textContent = err.message; }
    });
    panel.querySelector('#del')?.addEventListener('click', async () => {
      if (!confirm(`No.${it.no}（${it.species}）を削除します。元に戻せません。\n売れた生体は削除せず「販売済み」にしてください。よろしいですか？`)) return;
      try { await api(`/items/${encodeURIComponent(it.no)}`, { method: 'DELETE' }); state.items.delete(it.no); state.selected.delete(it.no); closePanel(); drawTable(); toast('削除しました'); }
      catch (err) { toast(err.message, { error: true }); }
    });
    panel.querySelector('[name=species]').focus();
  }

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

  // ---------- リストの取り込み ----------
  let preview = null;
  function renderImport() {
    shell(`
      <div class="page-head"><h1>リストの取り込み</h1></div>
      <div class="cols">
        <div class="card"><h2>ファイルから</h2>
          <div class="drop" id="drop">Excel（.xlsx）・CSV・テキストファイルをここにドラッグ<br>または <label class="btn" style="margin-top:8px">ファイルを選ぶ<input type="file" id="impFile" accept=".xlsx,.csv,.tsv,.txt" hidden></label></div>
          <p class="note">見出しの行（管理番号・種名・価格など）があれば列の順番は自由です。この画面の「CSVで書き出す」の形式もそのまま読み込めます。</p>
        </div>
        <div class="card"><h2>文章を貼り付け</h2>
          <label class="field"><span>ブログやSNSの文章をそのまま</span><textarea id="impText" rows="7" placeholder="No.101 ヒョウモントカゲモドキ ハイポタンジェリン ♂ ベビー 12,800円"></textarea></label>
          <button type="button" class="btn primary" id="impTextBtn">読み込んで確認する</button>
        </div>
      </div>
      <p class="err" id="impErr"></p>
      <div id="impResult"></div>`);
    const send = async (form) => {
      document.getElementById('impErr').textContent = '';
      try { preview = await api('/import/preview', { method: 'POST', form }); drawPreview(); }
      catch (e) { document.getElementById('impErr').textContent = e.message; }
    };
    const fileForm = (file) => { const f = new FormData(); f.append('file', file); return f; };
    document.getElementById('impFile').addEventListener('change', (e) => e.target.files[0] && send(fileForm(e.target.files[0])));
    document.getElementById('impTextBtn').onclick = () => { const f = new FormData(); f.append('text', document.getElementById('impText').value); send(f); };
    const drop = document.getElementById('drop');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) send(fileForm(f)); });
  }
  function drawPreview() {
    const box = document.getElementById('impResult');
    const rows = preview.rows;
    const nNew = rows.filter((r) => !r._exists).length;
    box.innerHTML = `<div class="card"><h2>${rows.length}件を読み取りました（新規 ${nNew}件・上書き ${rows.length - nNew}件）</h2>
      ${preview.warnings.map((w) => `<p class="warn">⚠ ${esc(w)}</p>`).join('')}
      <div class="toolbar"><label class="field" style="margin:0"><span>新規の生体を</span><select id="impStatus"><option value="available">すぐ公開する（販売中）</option><option value="hidden">非公開で取り込む</option></select></label></div>
      <div class="table-wrap"><table><thead><tr><th><input type="checkbox" id="impAll" checked aria-label="すべて選択"></th><th></th><th>管理番号</th><th>分類</th><th>種名・モルフ</th><th>性別・サイズ</th><th>価格</th><th>状態</th><th>確認事項</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr><td><input type="checkbox" data-i="${i}" checked></td><td><span class="tag ${r._exists ? 'upd' : 'new'}">${r._exists ? '上書き' : '新規'}</span></td>
        <td class="num">${esc(r.no || '自動')}</td><td>${esc(r.category)}</td><td class="name"><b>${esc(r.species || '（種名なし）')}</b><small>${esc(r.morph || '')}</small></td>
        <td>${esc([r.sex, r.size].filter(Boolean).join('・'))}</td><td>${r.price_ask ? 'ASK' : r.price != null ? yen(r.price) : '—'}</td><td>${r.status ? STATUS[r.status] : ''}</td>
        <td class="warn">${esc(r._warnings.join('／'))}</td></tr>`).join('')}</tbody></table></div>
      <p class="err" id="commitErr"></p>
      <button type="button" class="btn primary" id="impCommit">チェックした行を取り込む</button></div>`;
    document.getElementById('impAll').onchange = (e) => box.querySelectorAll('input[data-i]').forEach((c) => { c.checked = e.target.checked; });
    document.getElementById('impCommit').onclick = async () => {
      const chosen = [...box.querySelectorAll('input[data-i]:checked')].map((c) => rows[Number(c.dataset.i)]).filter((r) => r.species);
      if (!chosen.length) return (document.getElementById('commitErr').textContent = '取り込む行を選んでください（種名のない行は取り込めません）');
      try {
        const r = await api('/import/commit', { method: 'POST', body: { rows: chosen, newStatus: document.getElementById('impStatus').value } });
        await loadAll();
        preview = null;
        box.innerHTML = `<div class="card"><h2>取り込みが完了しました</h2><p>新規 ${r.created}件・上書き ${r.updated}件${r.errors.length ? `・エラー ${r.errors.length}件` : ''}</p>
          ${r.errors.map((e) => `<p class="warn">⚠ ${esc(e.no ? `No.${e.no}` : `${e.row}行目`)}：${esc(e.message)}</p>`).join('')}
          <button type="button" class="btn" data-view="stock">在庫一覧で確認する</button></div>`;
      } catch (e) { document.getElementById('commitErr').textContent = e.message; }
    };
  }

  // ---------- 店舗情報・サイト設定 ----------
  async function renderSettings() {
    shell('<p class="empty">読み込み中…</p>');
    const { settings: s } = await api('/settings');
    const f = (k, label, type = 'text', ph = '') => type === 'area'
      ? `<label class="field"><span>${label}</span><textarea name="${k}" placeholder="${esc(ph)}">${esc(s[k])}</textarea></label>`
      : `<label class="field"><span>${label}</span><input name="${k}" type="${type}" value="${esc(s[k])}" placeholder="${esc(ph)}"></label>`;
    document.getElementById('main').innerHTML = `
      <div class="page-head"><h1>店舗情報・サイト設定</h1><a class="btn" href="/" target="_blank" rel="noopener">公開サイトで確認 ↗</a></div>
      <form id="setForm"><div class="cols">
        <div class="card"><h2>店舗情報</h2>${f('shopName', '店名')}${f('tagline', 'キャッチコピー（トップの見出し）')}${f('intro', '店舗紹介文（トップに表示）', 'area')}
          ${f('address', '住所（2行目に駅からの道順など）', 'area')}${f('hours', '営業時間', 'area')}${f('holidays', '定休日')}</div>
        <div class="card"><h2>お問い合わせ・SNS</h2>${f('phone', '電話番号（在庫・買取の問い合わせ先）', 'tel')}${f('phone2', '電話番号2（空欄で非表示）', 'tel')}${f('phone2Label', '電話番号2の用途')}
          ${f('lineUrl', 'LINE 友だち追加URL', 'url')}${f('lineId', 'LINE ID（表示用）')}${f('twitterUrl', 'X（旧Twitter）のURL', 'url')}${f('instagramUrl', 'InstagramのURL', 'url')}${f('mapUrl', 'Googleマップ埋め込みURL', 'url')}</div>
        <div class="card"><h2>お知らせ・ページ</h2>${f('notice', 'サイト最上部のお知らせ（空欄で非表示）')}${f('eventInfo', 'イベント出店情報', 'area')}${f('buyback', '生体の買取・下取りページの本文（「・」で始まる行は箇条書き）', 'area')}</div>
        <div class="card"><h2>第一種動物取扱業の表示</h2>${f('bizName', '氏名又は名称')}${f('regType', '種別')}${f('regNo', '登録番号')}${f('regDate', '登録年月日')}${f('regExpiry', '有効期間の末日')}${f('manager', '動物取扱責任者')}</div>
        <div class="card"><h2>表示ルール</h2>${f('newDays', '「新入荷」として扱う日数', 'number')}${f('soldVisibleDays', '売約済みを自動でサイトから消す日数（0＝販売済みにするまで表示）', 'number')}
          <label class="field"><span>分類（カンマ区切り・この順でサイトに並びます）</span><textarea name="categories">${esc(s.categories.join(', '))}</textarea></label></div>
      </div>
      <p class="err" id="sErr"></p><button class="btn primary">保存する</button></form>`;
    document.getElementById('setForm').onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      body.newDays = Number(body.newDays) || 14;
      body.soldVisibleDays = Number(body.soldVisibleDays) || 0;
      body.categories = body.categories.split(/[,、\n]/).map((c) => c.trim()).filter(Boolean);
      try { const r = await api('/settings', { method: 'PUT', body }); state.categories = r.settings.categories; toast('保存しました（公開サイトに反映されました）'); }
      catch (err) { document.getElementById('sErr').textContent = err.message; }
    };
  }

  // ---------- スタッフ管理 ----------
  async function renderUsers() {
    shell('<p class="empty">読み込み中…</p>');
    const { users, limits } = await api('/users');
    const act = (r) => users.filter((u) => u.role === r && u.active).length;
    document.getElementById('main').innerHTML = `
      <div class="page-head"><h1>スタッフ管理</h1><p class="note">店主（価格を変更できる人）${act('owner')} / ${limits.owner}名　スタッフ ${act('staff')} / ${limits.staff}名</p></div>
      <div class="cols">
        <div class="card"><h2>アカウント一覧</h2><div class="table-wrap"><table><thead><tr><th>名前</th><th>ログインID</th><th>権限</th><th>状態</th><th>パスワード</th><th></th></tr></thead><tbody>
          ${users.map((u) => `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.login)}</td><td>${u.role === 'owner' ? '店主' : 'スタッフ'}</td><td>${u.active ? '利用中' : '<span class="warn">停止中</span>'}</td>
            <td><form class="pw" data-pw="${u.id}" style="display:flex;gap:4px"><input name="password" placeholder="新しいパスワード" minlength="6" style="width:150px;min-height:30px;border:1px solid var(--line);border-radius:4px;padding:0 6px"><button class="btn">変更</button></form></td>
            <td><button type="button" class="btn${u.active ? ' danger' : ''}" data-toggle="${u.id}" data-active="${u.active}">${u.active ? '停止する' : '再開する'}</button></td></tr>`).join('')}
        </tbody></table></div><p class="note">辞めたスタッフは「停止する」を押すと、その場でアプリが使えなくなります。</p></div>
        <form class="card" id="addUser" autocomplete="off"><h2>アカウントを追加</h2>
          <label class="field"><span>表示名</span><input name="name" required placeholder="山田"></label>
          <label class="field"><span>ログインID（半角英数）</span><input name="login" required placeholder="yamada" autocapitalize="off"></label>
          <label class="field"><span>パスワード（6文字以上）</span><input name="password" required minlength="6"></label>
          <label class="field"><span>権限</span><select name="role"><option value="staff">スタッフ（販売済み・売約の切り替えのみ）</option><option value="owner">店主（価格・登録・設定もできる）</option></select></label>
          <p class="err" id="uErr"></p><button class="btn primary">追加する</button></form>
      </div>`;
    document.getElementById('addUser').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/users', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('アカウントを追加しました'); renderUsers(); }
      catch (err) { document.getElementById('uErr').textContent = err.message; }
    };
    document.querySelectorAll('form.pw').forEach((f) => { f.onsubmit = async (e) => {
      e.preventDefault();
      try { await api(`/users/${f.dataset.pw}`, { method: 'PATCH', body: { password: new FormData(f).get('password') } }); toast('パスワードを変更しました'); f.reset(); }
      catch (err) { toast(err.message, { error: true }); }
    }; });
  }

  // ---------- 変更履歴 ----------
  async function renderLogs() {
    shell('<p class="empty">読み込み中…</p>');
    const { logs } = await api('/logs');
    const v = (x, ask) => (ask ? 'ASK' : x == null || x === '' ? '未設定' : yen(x));
    const label = (l) => {
      if (l.action === 'status') return `${STATUS[l.detail.from] || ''} → <b>${STATUS[l.detail.to] || ''}</b>`;
      if (l.action === 'price') return `価格 ${v(l.detail.price?.from, l.detail.price_ask?.from)} → <b>${v(l.detail.price?.to, l.detail.price_ask?.to)}</b>`;
      return { create: '新規登録', edit: '情報を編集', delete: '削除' }[l.action] || esc(l.action);
    };
    document.getElementById('main').innerHTML = `<div class="page-head"><h1>変更履歴</h1><p class="note">最新200件</p></div>
      <div class="table-wrap"><table><thead><tr><th>日時</th><th>操作した人</th><th>管理番号</th><th>内容</th></tr></thead><tbody>
      ${logs.map((l) => `<tr><td>${esc(fmtTime(l.at))}</td><td>${esc(l.user_name)}</td><td class="num">${esc(l.item_no)}</td><td>${label(l)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">履歴はまだありません</td></tr>'}
      </tbody></table></div>`;
  }

  // ---------- ログイン ----------
  function renderLogin(msg = '') {
    $root.innerHTML = `<div class="login"><form class="card" id="loginForm">
      <div class="brand"><img src="/img/icon.svg" alt=""><div><b>店主画面</b><div class="note">エキゾチックサプライ</div></div></div>
      <label class="field"><span>ログインID</span><input name="login" required autocomplete="username" autocapitalize="off"></label>
      <label class="field"><span>パスワード</span><input name="password" type="password" required autocomplete="current-password"></label>
      <p class="err" id="lErr">${esc(msg)}</p><button class="btn primary" style="width:100%;justify-content:center">ログイン</button></form></div>`;
    document.getElementById('loginForm').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); boot(); }
      catch (err) { document.getElementById('lErr').textContent = err.message; }
    };
  }

  // ---------- 操作の受け付け ----------
  document.addEventListener('click', (e) => {
    const t = e.target;
    const view = t.closest('[data-view]');
    if (view) return go(view.dataset.view);
    if (t.closest('[data-closepanel]')) return closePanel();
    if (t.closest('[data-logout]')) return api('/logout', { method: 'POST' }).catch(() => {}).then(() => { state.me = null; renderLogin(); });
    if (t.closest('[data-csv]')) return exportCsv();
    const st = t.closest('[data-status]');
    if (st) { state.filter.status = st.dataset.status; state.page = 1; state.selected.clear(); return renderStock(); }
    const sort = t.closest('th[data-sort]');
    if (sort) { const k = sort.dataset.sort; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : 1 }; return drawTable(); }
    const pg = t.closest('[data-page]');
    if (pg) { state.page += Number(pg.dataset.page); drawTable(); document.getElementById('main').scrollTop = 0; return; }
    const ed = t.closest('[data-edit]');
    if (ed) return openEditor(ed.dataset.edit);
    const tog = t.closest('[data-toggle]');
    if (tog) return api(`/users/${tog.dataset.toggle}`, { method: 'PATCH', body: { active: tog.dataset.active !== '1' } }).then(renderUsers).catch((err) => toast(err.message, { error: true }));
    if (t.closest('[data-clearsel]')) { state.selected.clear(); return drawTable(); }
    const ask = t.closest('[data-bulkask]');
    if (ask) return bulk('ask', ask.dataset.bulkask === '1', ask.dataset.bulkask === '1' ? 'ASKにしました' : 'ASKを外しました');
    if (t.closest('[data-bulkdel]')) return bulk('delete', null, '削除しました');
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-sel]')) { t.checked ? state.selected.add(t.dataset.sel) : state.selected.delete(t.dataset.sel); t.closest('tr').classList.toggle('is-selected', t.checked); return drawBulk(); }
    if (t.matches('[data-selall]')) { document.querySelectorAll('[data-sel]').forEach((c) => { c.checked = t.checked; t.checked ? state.selected.add(c.dataset.sel) : state.selected.delete(c.dataset.sel); c.closest('tr').classList.toggle('is-selected', t.checked); }); return drawBulk(); }
    if (t.matches('[data-st]')) return setStatus(t.dataset.st, t.value);
    if (t.matches('[data-ask]')) return patch(t.dataset.ask, { price_ask: t.checked }, `No.${t.dataset.ask} を${t.checked ? 'ASK（価格非公開）にしました' : '価格公開にしました'}`);
    if (t.matches('[data-price]')) {
      const it = state.items.get(t.dataset.price);
      const val = t.value === '' ? null : Number(t.value);
      if (val !== it.price) patch(it.no, { price: t.value }, `No.${it.no} の価格を ${val == null ? '未設定' : yen(val)} にしました`);
      return;
    }
    const b = t.closest('[data-bulk]');
    if (b && b.value) {
      const label = b.dataset.bulk === 'status' ? `「${STATUS[b.value]}」にしました` : `分類を「${b.value}」にしました`;
      return bulk(b.dataset.bulk, b.value, label);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-price]')) e.target.blur();
    if (e.key === 'Escape' && document.querySelector('.panel')) closePanel();
  });

  // ---------- スタッフの操作をリアルタイムで反映 ----------
  function listen() {
    const es = new EventSource('/api/events');
    es.addEventListener('item', async (e) => {
      const d = JSON.parse(e.data);
      if (d.status === 'deleted') { state.items.delete(d.no); refreshRow(d.no); return; }
      const known = state.items.get(d.no);
      if (known && known.updated_at === d.updated_at) return;
      try {
        const { item } = await api(`/items/${encodeURIComponent(d.no)}`);
        state.items.set(item.no, item);
        if (known && document.querySelector(`tr[data-row="${CSS.escape(item.no)}"]`)) refreshRow(item.no, true);
        else if (state.view === 'stock' && !document.querySelector('.panel')) drawTable();
      } catch { /* 次の更新で反映 */ }
    });
    es.addEventListener('reload', async () => { await loadAll().catch(() => {}); if (state.view === 'stock' && !document.querySelector('.panel')) drawTable(); });
  }

  async function boot() {
    try {
      const me = await api('/me');
      if (me.user.role !== 'owner') return renderLogin('この画面は店主専用です。スタッフの方はES在庫アプリをお使いください。');
      state.me = me.user;
      state.categories = me.categories;
      await loadAll();
      go('stock');
      if (!boot.listening) { listen(); boot.listening = true; }
    } catch (e) {
      if (e.status !== 401) $root.innerHTML = `<div class="boot">${esc(e.message)}</div>`;
    }
  }
  boot();
})();
