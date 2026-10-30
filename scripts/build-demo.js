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

// 「在庫が多い店」の見え方を確かめるための見本在庫（種名・モルフは実在、個体・価格は架空）
const CATALOG = {
  トカゲモドキ: [['ヒョウモントカゲモドキ', ['ハイポタンジェリン', 'マックスノー', 'スーパーマックスノー', 'トレンパーアルビノ', 'ベルアルビノ', 'ブラックナイト', 'マーフィーパターンレス', 'エクリプス', 'ラプター', 'ノーマル'], 8000, 60000, 26],
    ['ニシアフリカトカゲモドキ', ['オレオ', 'ホワイトアウト', 'ゼロ', 'キャラメルアルビノ', 'ノーマル'], 15000, 50000, 10], ['ヒガシインドトカゲモドキ', ['ノーマル'], 18000, 30000, 3]],
  ヤモリ: [['クレステッドゲッコー', ['ハーレクイン', 'リリーホワイト', 'ダルメシアン', 'ピンストライプ'], 15000, 80000, 12], ['ガーゴイルゲッコー', ['レッドストライプ', 'ブロッチ'], 20000, 45000, 5],
    ['ジャイアントゲッコー', ['GT', 'パインアイル', 'ヘンケリ'], 60000, 180000, 5], ['ナメハダタマオヤモリ', ['ノーマル'], 200000, 300000, 2]],
  トカゲ: [['フトアゴヒゲトカゲ', ['ハイポトランス', 'レザーバック', 'シトラス', 'ノーマル'], 12000, 60000, 9], ['アオジタトカゲ', ['ノーザン', 'インドネシアン', 'タニンバー'], 40000, 150000, 5],
    ['サバンナモニター', ['ノーマル'], 15000, 25000, 3], ['エリマキトカゲ', ['ノーマル'], 30000, 50000, 2]],
  蛇: [['ボールパイソン', ['パステル', 'バナナ', 'パイボールド', 'クラウン', 'スパイダー', 'モハベ'], 15000, 120000, 16], ['コーンスネーク', ['アメラニスティック', 'パルメット', 'スノー', 'アネリスリスティック'], 8000, 40000, 10],
    ['セイブシシバナヘビ', ['アルビノ', 'アナコンダ', 'スーパーアークティック'], 25000, 90000, 7], ['カリフォルニアキングスネーク', ['バンデッド', 'アベラント'], 15000, 35000, 4]],
  'カメレオン・ヒメカメレオン': [['パンサーカメレオン', ['アンビロブ', 'ノシベ', 'アンバンジャ'], 35000, 70000, 6], ['エボシカメレオン', ['ノーマル', 'トランスルーセント'], 15000, 40000, 4], ['ピグミーカメレオン', ['ノーマル'], 8000, 15000, 3]],
  陸ガメ: [['ヘルマンリクガメ', ['ニシ', 'ヒガシ'], 30000, 80000, 6], ['インドホシガメ', ['ノーマル'], 60000, 150000, 4], ['ケヅメリクガメ', ['ノーマル'], 25000, 40000, 3], ['ヒョウモンガメ', ['バブコッキー'], 40000, 70000, 3]],
  水棲ガメ: [['ミシシッピニオイガメ', ['ノーマル'], 5000, 9000, 4], ['クサガメ', ['ノーマル', '白化'], 4000, 60000, 3], ['ミスジドロガメ', ['ノーマル'], 15000, 25000, 2]],
  ハコガメ: [['ミツユビハコガメ', ['ノーマル'], 40000, 60000, 2], ['ニシキハコガメ', ['ノーマル'], 60000, 90000, 2]],
  カエル: [['ベルツノガエル', ['アルビノ', 'ノーマル', 'ペパーミント'], 4000, 15000, 7], ['イエアメガエル', ['ノーマル', 'スノー'], 6000, 30000, 4], ['ミルキーフロッグ', ['ノーマル'], 6000, 9000, 3]],
  'サラマンダー・イモリ': [['アホロートル', ['リューシ', 'ゴールデン', 'マーブル'], 3000, 8000, 6], ['ファイアサラマンダー', ['ノーマル'], 15000, 30000, 2]],
  奇虫: [['ダイオウサソリ', ['ノーマル'], 4000, 7000, 3], ['チリアンローズヘアー', ['ノーマル'], 5000, 8000, 2], ['ゴライアスバードイーター', ['ノーマル'], 30000, 50000, 2]],
  '中型大型インコ・オウム': [['シロハラインコ', ['ノーマル'], 280000, 380000, 2], ['コガネメキシコインコ', ['ノーマル'], 200000, 280000, 2], ['オオハナインコ', ['オス', 'メス'], 400000, 500000, 1]],
};
const SIZES = { 'トカゲモドキ': ['ベビー', 'ヤング', 'アダルト'], 'ヤモリ': ['ベビー', 'ヤング', 'アダルト'], '蛇': ['ベビー', 'ヤング', 'アダルト'], '陸ガメ': ['甲長6cm前後', '甲長10cm前後', '甲長15cm前後'], '水棲ガメ': ['甲長3cm前後', '甲長8cm前後'], 'ハコガメ': ['甲長10cm前後'] };
function generateStock(owner) {
  let seed = 20261030;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const arrivalDays = [0, 2, 5, 9, 13, 18, 24, 31, 40, 52]; // 入荷のあった日（何日前か）
  let no = 1001;
  for (const [category, list] of Object.entries(CATALOG)) {
    for (const [species, morphs, lo, hi, count] of list) {
      for (let i = 0; i < count; i++) {
        const ago = pick(arrivalDays);
        const price = Math.round((lo + rnd() * (hi - lo)) / 1000) * 1000 - 200;
        const r = rnd();
        items.create(owner, {
          no: String(no++), category, species, morph: pick(morphs),
          sex: category === '中型大型インコ・オウム' ? pick(['オス', 'メス']) : pick(['オス', 'メス', '不明', 'オス', 'メス']),
          size: pick(SIZES[category] || ['ベビー', 'ヤング', 'アダルト']), origin: pick(['CB', 'CB', 'CB', 'WB']),
          arrived_at: new Date(Date.UTC(2026, 9, 30) - ago * 864e5).toISOString().slice(0, 10),
          price: r < 0.06 ? null : price, price_ask: r < 0.06,
          status: r > 0.95 ? 'hidden' : r > 0.88 ? 'sold' : 'available',
        }, { silent: true });
      }
    }
  }
}

// 見本の在庫を、本番と同じ取り込み処理で作る
async function buildSeed() {
  const owner = { id: 1, name: '店主', role: 'owner' };
  for (const f of ['blog-sample.txt', 'list-sample.csv', 'list-sample.xlsx']) {
    const { rows } = await parseAny({ buffer: fs.readFileSync(path.join(ROOT, 'samples', f)), filename: f });
    items.importRows(owner, rows.map(({ _warnings, ...r }) => r));
  }
  items.create(owner, { no: '401', species: 'ヨウム', morph: 'コンゴウヨウム', sex: 'オス', size: '若鳥', origin: '国内CB', price: 380000, note: '手乗り。人によく慣れています' }, { silent: true });
  items.create(owner, { no: '402', species: 'オキナワシリケンイモリ', morph: 'アルビノ', sex: '不明', size: 'ヤング', origin: 'CB', price_ask: true }, { silent: true });
  generateStock(owner);
  items.create(owner, { no: '108', species: 'ヒョウモントカゲモドキ', morph: 'ブラックナイト', sex: 'オス', size: 'ベビー', price: 98000, status: 'hidden', note: '入荷直後のため準備中' }, { silent: true });
  saveSettings({
    intro: '大阪の寝屋川市の爬虫類と中型インコ専門店です。爬虫類店内在庫数2500匹オーバー、関西最大級の在庫量を誇っております。生体の買取・下取りもしておりますので、是非ご来店・お問い合わせください。',
    lineUrl: 'https://line.me/',
    lineId: '@exoticsupply（見本）',
    notice: '大阪府寝屋川市に店舗をオープン致しましたので是非お立ち寄り下さい♪ 営業時間 水木金土日14時〜20時',
    eventInfo: '〇〇レプタイルズ 出店予定（見本）\nブース番号は決まり次第お知らせします',
  });
  return { items: db.prepare('SELECT * FROM items').all().map(rowToItem), settings: getSettings() };
}

// <script> 内に埋め込むための加工
const jsSafe = (src) => src.replace(/<\/script/gi, '<\\/script');
const ICON = `data:image/svg+xml;base64,${Buffer.from(read('public/img/icon.svg')).toString('base64')}`;
const LOGO = `data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'public/img/logo.png')).toString('base64')}`;
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
    `<script>window.__ES = { seed: ${jsonSafe(seed)}, cssSite: ${jsonSafe(read('public/css/site.css'))}, cssStaff: ${jsonSafe(read('staff/app.css'))}, staffBody: ${jsonSafe(staffBody())}, icon: ${jsonSafe(ICON)}, logo: ${jsonSafe(LOGO)} };</script>`,
    `<script>const ES_MODULES = {\n${jsSafe(modules)}\n};</script>`,
    `<script>${jsSafe(staffApp())}</script>`,
    `<script>${jsSafe(read('demo/runtime.js'))}</script>`,
  ].join('\n');
  const out = read('demo/template.html').replace('<!--INJECT-->', inject);
  const file = path.join(ROOT, 'demo', 'exotic-supply-demo.html');
  fs.writeFileSync(file, out);
  console.log(`作成しました: demo/exotic-supply-demo.html（${(out.length / 1024).toFixed(0)} KB、在庫 ${seed.items.length} 件）`);
})();
