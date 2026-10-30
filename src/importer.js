'use strict';
// 店舗からもらうリストの読み込み。Excel（.xlsx）・CSV/TSV・ブログのような文章の
// どれでも受け付け、在庫データの行に変換する。取り込む前に必ずプレビューで確認する。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { DATA_DIR } = require('./db');

const HEADER_ALIASES = {
  no: ['管理番号', '番号', 'no', 'no.', 'id', '個体番号', '個体no', '管理no'],
  category: ['分類', 'カテゴリ', 'カテゴリー', '種類', 'ジャンル', '区分'],
  species: ['種名', '種', '生体名', '生体', '名前', '品名', '商品名', '和名'],
  morph: ['モルフ', '品種', 'カラー', '血統'],
  sex: ['性別', '雌雄', 'オスメス', 'sex'],
  size: ['サイズ', '全長', '大きさ', '体長', 'size'],
  origin: ['cb/wb', 'cb', 'wb', '産地', '由来', 'ブリード', '出自'],
  birth: ['ハッチ日', '生年月日', '誕生日', 'ハッチ', '孵化日', '生まれ'],
  arrived_at: ['入荷日', '入荷', '登録日', '入荷日付'],
  price: ['価格', '値段', '売価', '税込価格', '金額', '販売価格', '価格(税込)', 'price'],
  note: ['備考', 'コメント', '説明', 'メモ', '特徴'],
  photos: ['写真', '画像', '写真url', '画像url', 'photo', 'image'],
  status: ['状態', 'ステータス', '在庫', '在庫状況'],
};

const normKey = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s:：]/g, '');
const ALIAS_LOOKUP = new Map();
for (const [field, names] of Object.entries(HEADER_ALIASES)) for (const n of names) ALIAS_LOOKUP.set(normKey(n), field);
const fieldFor = (header) => ALIAS_LOOKUP.get(normKey(header));

// ---------- 値の正規化 ----------
const ASK_RE = /(ask|応相談|要問い?合わ?せ|お問い?合わ?せ|問い?合わ?せ|時価|price\s*on\s*request)/i;

function parsePrice(v) {
  const s = String(v ?? '').normalize('NFKC').trim();
  if (!s) return { price: null, price_ask: false };
  if (ASK_RE.test(s)) return { price: null, price_ask: true };
  const man = s.match(/([\d.]+)\s*万/);
  if (man) {
    const rest = s.slice(man.index + man[0].length).match(/^\s*([\d,]+)/);
    return { price: Math.round(Number(man[1]) * 10000 + (rest ? Number(rest[1].replace(/,/g, '')) : 0)), price_ask: false };
  }
  const num = s.replace(/[^\d.]/g, '');
  return num ? { price: Math.round(Number(num)), price_ask: false } : { price: null, price_ask: false };
}

function normSex(v) {
  const s = String(v ?? '').normalize('NFKC').trim();
  if (!s) return '';
  if (/ペア|pair|♂\s*♀|オスメス/i.test(s)) return 'ペア';
  if (/♂|オス|雄|male|^m$/i.test(s)) return 'オス';
  if (/♀|メス|雌|female|^f$/i.test(s)) return 'メス';
  if (/不明|未判別|未判定|\?/.test(s)) return '不明';
  return s;
}

function normStatus(v) {
  const s = String(v ?? '').normalize('NFKC').trim();
  if (!s) return undefined;
  if (/販売済|完売|売却|引渡|引き渡|done/i.test(s)) return 'done';
  if (/売約|sold|済/i.test(s)) return 'sold';
  if (/非公開|hidden|準備中|検疫/i.test(s)) return 'hidden';
  return 'available';
}

function normDate(v) {
  if (v instanceof Date && !isNaN(v)) return new Date(v.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) { // Excel のシリアル値
    return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  }
  const s = String(v ?? '').normalize('NFKC').trim();
  let m = s.match(/(\d{4})\s*[\/.\-年]\s*(\d{1,2})\s*[\/.\-月]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\s*[\/月]\s*(\d{1,2})日?$/);
  if (m) return `${new Date().getFullYear()}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return '';
}

// 種名から分類を推測（リストに分類列がない場合のため）。上から順に判定するので順番に意味がある：
// 「ヒョウモントカゲモドキ」はトカゲモドキ、「パンサーカメレオン」はカメレオン、「アカメカブトトカゲ」はトカゲ。
const CATEGORY_RULES = [
  ['トカゲモドキ', /トカゲモドキ|レオパ|ニシアフ|キャットゲッコー/],
  ['カメレオン・ヒメカメレオン', /カメレオン/],
  ['ヤモリ', /ヤモリ|ゲッコー|ゲッコ|クレス|ガーゴイル|リーキエ|ナメハダ|ジャイアントゲッコー/],
  ['トカゲ', /トカゲ|アガマ|モニター|スキンク|イグアナ|ドラゴン|フトアゴ|バシリスク|テグー|カナヘビ|ウロマスティクス|アノール|オオトカゲ/],
  ['蛇', /ヘビ|蛇|スネーク|パイソン|ボア|キングスネーク|ミルクスネーク|ホグノーズ|ラットスネーク/],
  ['ハコガメ', /ハコガメ|ボックスタートル/],
  ['陸ガメ', /リクガメ|トータス|ホシガメ|ヘルマン|ギリシャ|ケヅメ|ヒョウモンガメ|アカアシガメ|キアシガメ/],
  ['水棲ガメ', /ガメ|カメ|タートル/],
  ['カエル', /カエル|ガエル|フロッグ/],
  ['サラマンダー・イモリ', /イモリ|サンショウウオ|ウーパー|アホロートル|サラマンダー/],
  ['奇虫', /サソリ|タランチュラ|ムカデ|ヤスデ|ゲジ|ウデムシ|サソリモドキ|クモ/],
  ['中型大型インコ・オウム', /インコ|ヨウム|オウム|コニュア|シロハラ|ズグロ|アケボノ|ボウシ/],
];
function guessCategory(text, categories) {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(text) && (!categories || categories.includes(cat))) return cat;
  return '';
}

function finalizeRow(raw, categories) {
  const row = {};
  for (const k of ['no', 'category', 'species', 'morph', 'size', 'origin', 'note']) {
    if (raw[k] !== undefined && raw[k] !== null) row[k] = String(raw[k]).normalize('NFKC').trim();
  }
  if (row.no) row.no = row.no.replace(/^(no\.?|#|№)\s*/i, '');
  if (raw.sex !== undefined) row.sex = normSex(raw.sex);
  if (raw.birth !== undefined) row.birth = normDate(raw.birth) || String(raw.birth).trim();
  if (raw.arrived_at !== undefined) { const d = normDate(raw.arrived_at); if (d) row.arrived_at = d; }
  if (raw.price !== undefined || raw.price_ask) Object.assign(row, raw.price_ask ? { price: null, price_ask: true } : parsePrice(raw.price));
  const st = normStatus(raw.status);
  if (st) row.status = st;
  if (raw.photos) row.photos = (Array.isArray(raw.photos) ? raw.photos : String(raw.photos).split(/[\s,、]+/)).filter((u) => /^(https?:\/\/|\/uploads\/)/.test(u));
  if (row.species && (!row.category || (categories && !categories.includes(row.category)))) {
    row.category = guessCategory(`${row.species} ${row.morph || ''}`, categories) || row.category || '';
  }
  return row;
}

function rowWarnings(row) {
  const w = [];
  if (!row.species) w.push('種名がありません');
  if (row.price == null && !row.price_ask) w.push('価格がありません');
  if (!row.no) w.push('管理番号がないため自動採番します');
  return w;
}

// ---------- 表形式（CSV / TSV / Excel） ----------
function parseDelimited(text) {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delim = firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

function tableToRows(table, categories) {
  // 先頭10行のうち、見出しとして認識できる列が2つ以上ある行をヘッダーとみなす
  let headerIdx = -1, map = [];
  for (let i = 0; i < Math.min(10, table.length); i++) {
    const m = table[i].map(fieldFor);
    if (m.filter(Boolean).length >= 2) { headerIdx = i; map = m; break; }
  }
  if (headerIdx < 0) return null;
  const unknown = table[headerIdx].filter((h, i) => !map[i] && String(h).trim());
  const rows = [];
  for (const line of table.slice(headerIdx + 1)) {
    const raw = {};
    line.forEach((v, i) => {
      const f = map[i];
      if (!f || v === '' || v == null) return;
      raw[f] = raw[f] !== undefined && f === 'note' ? `${raw[f]} ${v}` : v;
    });
    if (Object.keys(raw).length) rows.push({ raw, line });
  }
  return { rows: rows.map(({ raw }) => finalizeRow(raw, categories)), unknownHeaders: unknown, headerRowIndex: headerIdx };
}

function cellToValue(v) {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text !== undefined) return v.hyperlink && /^https?:/.test(v.hyperlink) ? v.hyperlink : v.text;
    if (v.result !== undefined) return cellToValue(v.result);
    if (v.error) return '';
  }
  return v;
}

async function parseXlsx(buffer, categories) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets.find((s) => s.actualRowCount > 0);
  if (!ws) return { rows: [], warnings: ['シートが空です'] };
  const table = [];
  const rowNumbers = [];
  ws.eachRow({ includeEmpty: false }, (r, n) => {
    const vals = [];
    for (let c = 1; c <= ws.columnCount; c++) vals.push(cellToValue(r.getCell(c).value));
    table.push(vals);
    rowNumbers.push(n);
  });
  const parsed = tableToRows(table.map((r) => r.map((v) => (v instanceof Date ? v : String(v)))), categories);
  if (!parsed) return { rows: [], warnings: ['見出し行（管理番号・種名・価格など）が見つかりませんでした'] };

  // Excel に貼り付けられた写真を、その行の生体の写真として取り込む
  const images = ws.getImages?.() || [];
  if (images.length) {
    const dataRowNumbers = rowNumbers.slice(parsed.headerRowIndex + 1);
    for (const img of images) {
      const media = wb.model.media?.[Number(img.imageId)] || wb.getImage(Number(img.imageId));
      if (!media?.buffer) continue;
      const excelRow = Math.floor(img.range.tl.nativeRow ?? img.range.tl.row) + 1;
      const idx = dataRowNumbers.indexOf(excelRow);
      if (idx < 0 || !parsed.rows[idx]) continue;
      const url = saveUpload(media.buffer, media.extension || 'jpg');
      (parsed.rows[idx].photos ||= []).push(url);
    }
  }
  return { rows: parsed.rows, warnings: parsed.unknownHeaders.length ? [`読み込まなかった列：${parsed.unknownHeaders.join('、')}`] : [] };
}

// ---------- 文章（ブログ・SNS 投稿の貼り付け） ----------
const SEP_LINE = /^\s*([-=＝ー─━_*＊~〜・■□◆◇●○★☆]\s*){3,}\s*$/;
const KV_LINE = /^\s*[【\[]?([^:：】\]]{1,10})[】\]]?\s*[:：]\s*(.+)$/;

function parseLine(line, categories) {
  let s = line.normalize('NFKC').replace(/^[\s・●○◆◇■□★☆▼▶►\-*]+/, '').trim();
  const raw = {};
  const take = (re, fn) => { const m = s.match(re); if (m) { fn(m); s = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).trim(); } return !!m; };

  take(/(?:管理番号|管理no\.?|no\.?|№|#)\s*([a-z]{0,3}-?\d+)/i, (m) => { raw.no = m[1]; })
    || take(/^[\[【(（]?(\d{1,6})[\]】)）.、:]\s*/, (m) => { raw.no = m[1]; });
  if (!take(new RegExp(`(?:価格|値段|売価)?\\s*[:]?\\s*${ASK_RE.source}`, 'i'), () => { raw.price_ask = true; })) {
    take(/(?:価格|値段|売価)?\s*[:]?\s*(?:[¥￥]\s*([\d,]+)|([\d.]+\s*万\s*(?:[\d,]+)?|[\d,]+)\s*円)\s*(?:[(（]?\s*税込\s*[)）]?)?/, (m) => { raw.price = m[1] || m[2]; });
  }
  take(/(♂\s*♀|ペア|♂|♀|オス|メス|雄|雌|性別不明|不明)/, (m) => { raw.sex = m[1]; });
  take(/(\d{4}\s*[\/.年-]\s*\d{1,2}\s*月?(?:\s*[\/.-]?\s*\d{1,2}\s*日?)?)\s*(?:ハッチ|生まれ|生|孵化|産)/, (m) => { raw.birth = m[1]; })
    || take(/(?:ハッチ|生まれ)\s*[:]?\s*(\d{4}\s*[\/.年-]\s*\d{1,2}\s*月?(?:\s*[\/.-]?\s*\d{1,2}\s*日?)?)/, (m) => { raw.birth = m[1]; });
  take(/((?:全長|体長|サイズ)\s*[:]?\s*)?(約?\s*\d+(?:\.\d+)?\s*(?:cm|mm|g)(?:\s*(?:前後|程度|くらい|位|ほど))?|ベビー〜ヤング|ヤング〜アダルト|ベビー|ヤング|サブアダルト|アダルト|ハッチリング)/i, (m) => { raw.size = m[2]; });
  take(/(国内CB|海外CB|CB|WB|FH|CH|LTC)(?![a-z])/i, (m) => { raw.origin = m[1].toUpperCase().replace('国内CB', '国内CB'); });

  s = s.replace(/[\/|｜,、]+/g, ' ').replace(/\s+/g, ' ').trim();
  const paren = s.match(/^(.+?)\s*[(（「]([^)）」]+)[)）」]\s*(.*)$/);
  if (paren) { raw.species = paren[1].trim(); raw.morph = [paren[2], paren[3]].filter(Boolean).join(' ').trim(); }
  else {
    const [first, ...rest] = s.split(' ');
    raw.species = first || '';
    raw.morph = rest.join(' ');
  }
  return finalizeRow(raw, categories);
}

function parseText(text, categories) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let cur = [];
  for (const l of lines) {
    if (!l.trim() || SEP_LINE.test(l)) { if (cur.length) blocks.push(cur); cur = []; } else cur.push(l);
  }
  if (cur.length) blocks.push(cur);

  const rows = [];
  const skipped = [];
  for (const block of blocks) {
    const kv = block.map((l) => l.normalize('NFKC').match(KV_LINE)).map((m) => m && fieldFor(m[1]) ? [fieldFor(m[1]), m[2].trim()] : null);
    if (kv.filter(Boolean).length >= 2) {
      // 「種名：〇〇」「価格：〇〇円」のような項目形式のまとまり
      const raw = {};
      const extra = [];
      block.forEach((l, i) => { if (kv[i]) raw[kv[i][0]] = kv[i][1]; else extra.push(l.trim()); });
      if (!raw.species && extra.length) { const p = parseLine(extra.shift(), categories); Object.assign(raw, { ...p, ...raw }); }
      if (extra.length) raw.note = [raw.note, ...extra].filter(Boolean).join(' ');
      rows.push(finalizeRow(raw, categories));
      continue;
    }
    // 1行1個体の形式
    for (const l of block) {
      const r = parseLine(l, categories);
      const looksLikeItem = r.species && (r.price != null || r.price_ask || r.no || r.sex);
      if (looksLikeItem) rows.push(r); else skipped.push(l.trim());
    }
  }
  return { rows, warnings: skipped.length ? [`生体として読み取れなかった行（${skipped.length}行）：${skipped.slice(0, 5).join(' / ')}${skipped.length > 5 ? ' …' : ''}`] : [] };
}

function decodeText(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, ''); }
  catch { return new TextDecoder('shift_jis').decode(buffer); } // 日本語版 Excel の CSV は Shift_JIS
}

async function parseAny({ buffer, filename = '', text, categories }) {
  let result;
  if (buffer && /\.xlsx$/i.test(filename)) result = await parseXlsx(buffer, categories);
  else {
    const src = text ?? decodeText(buffer);
    const table = /\.(csv|tsv)$/i.test(filename) || /^[^\n]*[,\t][^\n]*\n/.test(src) ? tableToRows(parseDelimited(src), categories) : null;
    result = table ? { rows: table.rows, warnings: table.unknownHeaders.length ? [`読み込まなかった列：${table.unknownHeaders.join('、')}`] : [] } : parseText(src, categories);
  }
  result.rows = result.rows.map((r) => ({ ...r, _warnings: rowWarnings(r) }));
  return result;
}

function saveUpload(buffer, ext = 'jpg') {
  const safeExt = /^(jpe?g|png|webp|gif)$/i.test(ext) ? ext.toLowerCase().replace('jpeg', 'jpg') : 'jpg';
  const name = `${crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 20)}.${safeExt}`;
  const file = path.join(DATA_DIR, 'uploads', name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buffer);
  return `/uploads/${name}`;
}

module.exports = { parseAny, parseText, parseLine, parseDelimited, parsePrice, normSex, normDate, guessCategory, saveUpload, HEADER_ALIASES };
