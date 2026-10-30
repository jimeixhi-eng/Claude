'use strict';
// ブラウザだけで動くデモページ（demo/exotic-supply-demo.html）を作る： npm run build:demo
// 本番のプログラム（公開サイトの表示・CSS・スタッフアプリ）をそのまま1枚の HTML に詰め、
// サーバーの役割は demo/runtime.js がブラウザ内で再現する。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'es-demo-'));

const { db, getSettings, saveSettings, rowToItem } = require('../src/db');
const items = require('../src/items');
const { parseAny } = require('../src/importer');

// 見本の在庫を、本番と同じ取り込み処理で作る
async function buildSeed() {
  const owner = { id: 1, name: '店主', role: 'owner' };
  for (const f of ['blog-sample.txt', 'list-sample.csv', 'list-sample.xlsx']) {
    const { rows } = await parseAny({ buffer: fs.readFileSync(path.join(ROOT, 'samples', f)), filename: f });
    items.importRows(owner, rows.map(({ _warnings, ...r }) => r));
  }
  items.create(owner, { no: '108', species: 'ヒョウモントカゲモドキ', morph: 'ブラックナイト', sex: 'オス', size: 'ベビー', price: 98000, status: 'hidden', note: '入荷直後のため準備中' }, { silent: true });
  saveSettings({
    address: '東京都〇〇区〇〇 1-2-3（見本）',
    hours: '13:00〜20:00\n土日祝 12:00〜19:00',
    holidays: '毎週水曜日',
    phone: '03-0000-0000',
    lineUrl: 'https://line.me/',
    lineId: '@exoticsupply（見本）',
    notice: '11/3（祝）はレプタイルズイベント出店のため店舗休業です',
    eventInfo: '11/3（祝）〇〇レプタイルズフェア 出店予定\nブース番号は決まり次第お知らせします',
    regNo: '動販 第000000号（見本）',
    regDate: '2024年4月1日',
    regExpiry: '2029年3月31日',
    manager: '山田 太郎（見本）',
  });
  return { items: db.prepare('SELECT * FROM items').all().map(rowToItem), settings: getSettings() };
}

// <script> 内に埋め込むための加工
const jsSafe = (src) => src.replace(/<\/script/gi, '<\\/script');
const ICON = `data:image/svg+xml;base64,${Buffer.from(read('public/img/icon.svg')).toString('base64')}`;
const jsonSafe = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

function staffApp() {
  let src = read('staff/app.js');
  const swaps = [
    ["navigator.onLine", 'env.online()'],
    ["'serviceWorker' in navigator", 'false'],
    ["window.open('/', '_blank')", 'env.openSite()'],
    ["addEventListener('online', setOnline)", "env.on('online', setOnline)"],
    ["addEventListener('offline', setOnline)", "env.on('offline', setOnline)"],
    ['setInterval(', 'env.setInterval('],
  ];
  for (const [from, to] of swaps) {
    if (!src.includes(from)) throw new Error(`staff/app.js に「${from}」が見つかりません（デモ用の置き換えを見直してください）`);
    src = src.split(from).join(to);
  }
  src = src.split('/img/icon.svg').join(ICON);
  return `function startStaff(env) {\n  const { document, fetch, EventSource, localStorage, confirm, prompt } = env;\n${src}\n}`;
}

function staffBody() {
  const html = read('staff/index.html');
  return html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '').trim();
}

(async () => {
  const seed = await buildSeed();
  const modules = ['views', 'importer'].map((m) => `'./${m}': function (require, module, exports) {\n${read(`src/${m}.js`)}\n}`).join(',\n');
  const inject = [
    `<script>window.__ES = { seed: ${jsonSafe(seed)}, cssSite: ${jsonSafe(read('public/css/site.css'))}, cssStaff: ${jsonSafe(read('staff/app.css'))}, staffBody: ${jsonSafe(staffBody())}, icon: ${jsonSafe(ICON)} };</script>`,
    `<script>const ES_MODULES = {\n${jsSafe(modules)}\n};</script>`,
    `<script>${jsSafe(staffApp())}</script>`,
    `<script>${jsSafe(read('demo/runtime.js'))}</script>`,
  ].join('\n');
  const out = read('demo/template.html').replace('<!--INJECT-->', inject);
  const file = path.join(ROOT, 'demo', 'exotic-supply-demo.html');
  fs.writeFileSync(file, out);
  console.log(`作成しました: demo/exotic-supply-demo.html（${(out.length / 1024).toFixed(0)} KB、在庫 ${seed.items.length} 件）`);
})();
