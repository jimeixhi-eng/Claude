'use strict';
// データベース（SQLite）。在庫の「正本」はここだけに置き、
// 公開サイト・スタッフアプリ・一括取り込みはすべてここを読み書きする。
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = new DatabaseSync(process.env.DB_PATH || path.join(DATA_DIR, 'exotic-supply.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    no          TEXT NOT NULL UNIQUE,          -- 管理番号
    category    TEXT NOT NULL DEFAULT '',      -- 分類（ヤモリ・トカゲ・ヘビ…）
    species     TEXT NOT NULL,                 -- 種名
    morph       TEXT NOT NULL DEFAULT '',      -- モルフ
    sex         TEXT NOT NULL DEFAULT '',      -- 性別
    size        TEXT NOT NULL DEFAULT '',      -- サイズ
    origin      TEXT NOT NULL DEFAULT '',      -- CB / WB / 産地など
    birth       TEXT NOT NULL DEFAULT '',      -- ハッチ日・生年月日
    arrived_at  TEXT NOT NULL,                 -- 入荷日 YYYY-MM-DD
    price       INTEGER,                       -- 税込価格（円）
    price_ask   INTEGER NOT NULL DEFAULT 0,    -- 1 = 価格非公開（ASK）
    status      TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold','hidden')),
    sold_at     TEXT,
    note        TEXT NOT NULL DEFAULT '',
    photos      TEXT NOT NULL DEFAULT '[]',    -- JSON 配列（URL）
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS items_status ON items(status, arrived_at);

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    login      TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('owner','staff')),
    pass_hash  TEXT NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS logs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    at        TEXT NOT NULL DEFAULT (datetime('now')),
    user_id   INTEGER,
    user_name TEXT NOT NULL DEFAULT '',
    item_id   INTEGER,
    item_no   TEXT NOT NULL DEFAULT '',
    action    TEXT NOT NULL,
    detail    TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS logs_at ON logs(at);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const STATUSES = { available: '販売中', sold: '売約済み', hidden: '非公開' };
const ROLE_LIMITS = { owner: 2, staff: 20 };

const DEFAULT_SETTINGS = {
  shopName: 'エキゾチックサプライ',
  tagline: '大阪・寝屋川の爬虫類と中型インコ専門店',
  intro: '',
  address: '大阪府寝屋川市田井西町33-6\n京阪 香里園駅 7番出口より徒歩7分',
  hours: '水・木・金・土・日 14:00〜20:00',
  holidays: '月曜・火曜',
  phone: '080-5349-3261',             // 爬虫類の在庫・入荷・買取・下取り
  phone2: '080-5359-4395',            // 飼育相談・鳥・小動物
  phone2Label: '飼育相談・鳥・小動物',
  lineUrl: '',
  lineId: '',
  mapUrl: '',
  eventInfo: '',
  twitterUrl: 'https://x.com/exotic_supply_',
  instagramUrl: 'https://www.instagram.com/exotic_supply_osaka/',
  // 生体の買取・下取りページの本文（「・」で始まる行は箇条書きになる）
  buyback: [
    '飼育できなくなった生体や、ご自宅で繁殖させた生体の買取・下取りを行っています。',
    '・店頭でのお持ち込み査定',
    '・発送による買取（事前にご相談ください）',
    '・当店での生体ご購入時の下取り',
    'お持ち込み・発送の前に、LINEまたはお電話で「種類・性別・状態・写真」をお送りください。査定額の目安をお伝えします。',
  ].join('\n'),
  notice: '',
  // 動物取扱業の標識（法定表示）
  bizName: '',
  regNo: '大阪府登録4330-1号',
  regDate: '',
  regExpiry: '',
  regType: '販売',
  manager: '',
  // 表示ルール
  newDays: 14,        // 入荷から何日間「新着」扱いにするか
  soldVisibleDays: 7, // 売約済みを何日間サイトに残すか
  categories: ['トカゲモドキ', 'ヤモリ', 'トカゲ', '蛇', 'カメレオン・ヒメカメレオン', '陸ガメ', '水棲ガメ', 'ハコガメ', 'カエル', 'サラマンダー・イモリ', '奇虫', '中型大型インコ・オウム', 'その他'],
};

function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    try { out[row.key] = JSON.parse(row.value); } catch { /* 壊れた値は既定値のまま */ }
  }
  return out;
}

function saveSettings(patch) {
  const stmt = db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(patch)) {
    if (k in DEFAULT_SETTINGS) stmt.run(k, JSON.stringify(v));
  }
  return getSettings();
}

function rowToItem(r) {
  if (!r) return null;
  return { ...r, price_ask: !!r.price_ask, photos: JSON.parse(r.photos || '[]') };
}

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, DATA_DIR, STATUSES, ROLE_LIMITS, DEFAULT_SETTINGS, getSettings, saveSettings, rowToItem, tx };
