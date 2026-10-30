'use strict';
// 在庫データの読み書き。権限チェック・変更履歴・リアルタイム通知はすべてここを通す。
const { db, STATUSES, getSettings, rowToItem, tx } = require('./db');
const { broadcast } = require('./realtime');

const EDITABLE = ['category', 'species', 'morph', 'sex', 'size', 'origin', 'birth', 'arrived_at', 'note', 'photos'];
const PRICE_FIELDS = ['price', 'price_ask'];

const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // 日本時間の日付

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function getByNo(no) {
  return rowToItem(db.prepare('SELECT * FROM items WHERE no = ?').get(String(no)));
}
function getById(id) {
  return rowToItem(db.prepare('SELECT * FROM items WHERE id = ?').get(Number(id)));
}

// 公開サイトに出してよい在庫（販売中＋売約から一定日数以内）
function publicVisibleSql() {
  const { soldVisibleDays } = getSettings();
  return { where: `(status = 'available' OR (status = 'sold' AND sold_at >= datetime('now', ?)))`, params: [`-${Number(soldVisibleDays) || 0} days`] };
}

function listPublic({ category, species, status, q, sort, sex } = {}) {
  const vis = publicVisibleSql();
  const where = [vis.where];
  const params = [...vis.params];
  if (category) { where.push('category = ?'); params.push(category); }
  if (species) { where.push('species = ?'); params.push(species); }
  if (status === 'available' || status === 'sold') { where.push('status = ?'); params.push(status); }
  if (sex) { where.push('sex = ?'); params.push(sex); }
  if (q) {
    where.push(`(species LIKE ? OR morph LIKE ? OR no = ? OR note LIKE ?)`);
    params.push(`%${q}%`, `%${q}%`, q, `%${q}%`);
  }
  const order = {
    price_asc: `price_ask, price IS NULL, price ASC`,
    price_desc: `price_ask, price IS NULL, price DESC`,
    name: `species, morph`,
  }[sort] || `arrived_at DESC, id DESC`;
  // 販売中を先、売約済みを後ろに
  return db.prepare(`SELECT * FROM items WHERE ${where.join(' AND ')} ORDER BY status = 'sold', ${order}`).all(...params).map(rowToItem);
}

function listNewArrivals(limit = 12) {
  const { newDays } = getSettings();
  const since = new Date(Date.now() + 9 * 3600e3 - (Number(newDays) || 14) * 864e5).toISOString().slice(0, 10);
  return db.prepare(`SELECT * FROM items WHERE status = 'available' AND arrived_at >= ? ORDER BY arrived_at DESC, id DESC LIMIT ?`)
    .all(since, limit).map(rowToItem);
}

function isNew(item) {
  const { newDays } = getSettings();
  const since = new Date(Date.now() + 9 * 3600e3 - (Number(newDays) || 14) * 864e5).toISOString().slice(0, 10);
  return item.status === 'available' && item.arrived_at >= since;
}

// 分類ごと・種名ごとの販売中の匹数（生体カテゴリのメニュー用）
function speciesCounts() {
  return db.prepare(`SELECT category, species, COUNT(*) AS n FROM items WHERE status = 'available' GROUP BY category, species ORDER BY category, n DESC, species`).all();
}

// 新入荷のまとめ：入荷日ごと・種名ごとの匹数（トップページの文字の一覧用）
function newArrivalSummary(maxDays = 8) {
  const { newDays } = getSettings();
  const since = new Date(Date.now() + 9 * 3600e3 - (Number(newDays) || 14) * 864e5).toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT arrived_at, category, species, COUNT(*) AS n FROM items WHERE status = 'available' AND arrived_at >= ?
    GROUP BY arrived_at, category, species ORDER BY arrived_at DESC, category, n DESC`).all(since);
  const days = [...new Set(rows.map((r) => r.arrived_at))].slice(0, maxDays);
  return rows.filter((r) => days.includes(r.arrived_at));
}

function countsPublic() {
  const vis = publicVisibleSql();
  return db.prepare(`SELECT category, COUNT(*) AS n FROM items WHERE status = 'available' GROUP BY category`).all()
    .concat([{ category: '__sold', n: db.prepare(`SELECT COUNT(*) AS n FROM items WHERE ${vis.where} AND status='sold'`).get(...vis.params).n }]);
}

function listStaff({ q, status, limit = 60 } = {}) {
  const where = ['1=1'];
  const params = [];
  if (status && STATUSES[status]) { where.push('status = ?'); params.push(status); }
  if (q) {
    where.push(`(no LIKE ? OR species LIKE ? OR morph LIKE ?)`);
    params.push(`${q}%`, `%${q}%`, `%${q}%`);
  }
  // 管理番号が完全一致したものを一番上に
  return db.prepare(`SELECT * FROM items WHERE ${where.join(' AND ')} ORDER BY (no = ?) DESC, updated_at DESC LIMIT ?`)
    .all(...params, q || '', Number(limit) || 60).map(rowToItem);
}

function log(user, item, action, detail = {}) {
  db.prepare('INSERT INTO logs(user_id, user_name, item_id, item_no, action, detail) VALUES(?, ?, ?, ?, ?, ?)')
    .run(user?.id ?? null, user?.name ?? 'system', item?.id ?? null, item?.no ?? '', action, JSON.stringify(detail));
}

function notify(item) {
  broadcast('item', { id: item.id, no: item.no, status: item.status, updated_at: item.updated_at });
}

function setStatus(user, no, status) {
  if (!STATUSES[status]) throw new HttpError(400, 'ステータスが不正です');
  const before = getByNo(no);
  if (!before) throw new HttpError(404, `管理番号 ${no} は見つかりません`);
  if (before.status === status) return before;
  db.prepare(`UPDATE items SET status = ?, sold_at = CASE WHEN ? = 'sold' THEN datetime('now') WHEN ? = 'available' THEN NULL ELSE sold_at END,
              updated_at = datetime('now') WHERE id = ?`).run(status, status, status, before.id);
  const after = getById(before.id);
  log(user, after, 'status', { from: before.status, to: status });
  notify(after);
  return after;
}

function normalize(input) {
  const out = {};
  for (const k of EDITABLE) {
    if (input[k] === undefined) continue;
    out[k] = k === 'photos' ? JSON.stringify(Array.isArray(input.photos) ? input.photos.map(String) : []) : String(input[k] ?? '').trim();
  }
  if ('price' in input) {
    const p = input.price === '' || input.price === null ? null : Math.round(Number(String(input.price).replace(/[^\d.]/g, '')));
    out.price = Number.isFinite(p) ? p : null;
  }
  if ('price_ask' in input) out.price_ask = input.price_ask ? 1 : 0;
  if (out.arrived_at !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(out.arrived_at)) out.arrived_at = today();
  return out;
}

function assertCanEdit(user, fields) {
  if (user.role === 'owner') return;
  if (Object.keys(fields).some((k) => PRICE_FIELDS.includes(k) || EDITABLE.includes(k))) {
    throw new HttpError(403, '生体情報・価格の変更は店主のみ可能です');
  }
}

// reserved: 同じ取り込み内で使う予定の番号（自動採番でぶつからないように）
function nextNo(reserved = []) {
  const row = db.prepare(`SELECT MAX(CAST(no AS INTEGER)) AS n FROM items WHERE no GLOB '[0-9]*'`).get();
  const max = Math.max(row.n || 0, ...reserved.filter((n) => /^\d+$/.test(n)).map(Number));
  return String(max + 1);
}

function create(user, input, { silent = false } = {}) {
  assertCanEdit(user, { price: 1 });
  const f = normalize(input);
  if (!f.species) throw new HttpError(400, '種名は必須です');
  if (!f.category) f.category = require('./importer').guessCategory(`${f.species} ${f.morph || ''}`, getSettings().categories);
  const no = String(input.no ?? '').trim() || nextNo();
  if (getByNo(no)) throw new HttpError(409, `管理番号 ${no} は既に使われています`);
  const status = STATUSES[input.status] ? input.status : 'available';
  const cols = { no, status, arrived_at: today(), ...f };
  if (status === 'sold') cols.sold_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const keys = Object.keys(cols);
  const info = db.prepare(`INSERT INTO items(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map((k) => cols[k]));
  const item = getById(info.lastInsertRowid);
  log(user, item, 'create', { species: item.species, price: item.price, price_ask: item.price_ask });
  if (!silent) notify(item);
  return item;
}

function update(user, no, input, { silent = false } = {}) {
  const before = getByNo(no);
  if (!before) throw new HttpError(404, `管理番号 ${no} は見つかりません`);
  const f = normalize(input);
  assertCanEdit(user, f);
  if (input.no !== undefined && String(input.no).trim() && String(input.no).trim() !== before.no) {
    const newNo = String(input.no).trim();
    if (getByNo(newNo)) throw new HttpError(409, `管理番号 ${newNo} は既に使われています`);
    f.no = newNo;
  }
  const changes = {};
  for (const [k, v] of Object.entries(f)) {
    const old = k === 'photos' ? JSON.stringify(before.photos) : k === 'price_ask' ? (before.price_ask ? 1 : 0) : before[k];
    if (old !== v) changes[k] = { from: old, to: v };
  }
  if (!Object.keys(changes).length && !STATUSES[input.status]) return before;
  if (Object.keys(changes).length) {
    const keys = Object.keys(changes);
    db.prepare(`UPDATE items SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...keys.map((k) => f[k]), before.id);
    const after = getById(before.id);
    const priceChanged = keys.some((k) => PRICE_FIELDS.includes(k));
    log(user, after, priceChanged ? 'price' : 'edit', changes);
  }
  let item = getById(before.id);
  if (STATUSES[input.status] && input.status !== item.status) item = setStatus(user, item.no, input.status);
  else if (!silent) notify(item);
  return item;
}

function remove(user, no) {
  const item = getByNo(no);
  if (!item) throw new HttpError(404, `管理番号 ${no} は見つかりません`);
  if (user.role !== 'owner') throw new HttpError(403, '削除は店主のみ可能です');
  db.prepare('DELETE FROM items WHERE id = ?').run(item.id);
  log(user, item, 'delete', { species: item.species });
  broadcast('item', { id: item.id, no: item.no, status: 'deleted' });
}

// 一括取り込み（管理番号が同じものは上書き、なければ新規）
function importRows(user, rows, { newStatus = 'available' } = {}) {
  if (user.role !== 'owner') throw new HttpError(403, '取り込みは店主のみ可能です');
  const result = { created: 0, updated: 0, errors: [] };
  const reserved = rows.map((r) => String(r.no ?? '').trim()).filter(Boolean);
  tx(() => {
    rows.forEach((r, i) => {
      try {
        if (!String(r.no ?? '').trim()) { r = { ...r, no: nextNo(reserved) }; reserved.push(r.no); }
        if (r.no && getByNo(r.no)) { update(user, r.no, r, { silent: true }); result.updated++; }
        else { create(user, { ...r, status: r.status || newStatus }, { silent: true }); result.created++; }
      } catch (e) {
        result.errors.push({ row: i + 1, no: r.no, message: e.message });
      }
    });
  });
  broadcast('reload', { reason: 'import' });
  return result;
}

function recentLogs(limit = 100) {
  return db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(limit).map((l) => ({ ...l, detail: JSON.parse(l.detail) }));
}

function todayStats() {
  const startJst = today();
  const sinceUtc = new Date(new Date(`${startJst}T00:00:00+09:00`).getTime()).toISOString().replace('T', ' ').slice(0, 19);
  return {
    available: db.prepare(`SELECT COUNT(*) n FROM items WHERE status='available'`).get().n,
    hidden: db.prepare(`SELECT COUNT(*) n FROM items WHERE status='hidden'`).get().n,
    soldToday: db.prepare(`SELECT COUNT(*) n FROM items WHERE status='sold' AND sold_at >= ?`).get(sinceUtc).n,
  };
}

module.exports = {
  HttpError, getByNo, listPublic, listNewArrivals, listStaff, countsPublic, speciesCounts, newArrivalSummary, isNew, setStatus,
  create, update, remove, importRows, recentLogs, todayStats, nextNo, today,
};
