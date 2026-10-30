'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'es-test-'));
const app = require('../server');
const { parseLine, parseText, parsePrice } = require('../src/importer');

let base, server;
test.before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.closeAllConnections(); server.close(); });

function client() {
  let cookie = '';
  return async (p, { method = 'GET', body } = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'X-Requested-With': 'es-staff', 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
      body: body && JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}

const owner = client();
const staff = client();

test('初回セットアップで店主を作成し、スタッフを追加できる', async () => {
  assert.equal((await owner('/api/setup-needed')).data.needed, true);
  assert.equal((await owner('/api/setup', { method: 'POST', body: { login: 'tencho', name: '店主', password: 'secret1' } })).status, 200);
  assert.equal((await owner('/api/setup', { method: 'POST', body: { login: 'x', name: 'x', password: 'secret1' } })).status, 409);
  assert.equal((await owner('/api/users', { method: 'POST', body: { login: 'staff1', name: 'スタッフ1', password: 'secret1', role: 'staff' } })).status, 200);
  assert.equal((await staff('/api/login', { method: 'POST', body: { login: 'staff1', password: 'wrong' } })).status, 401);
  assert.equal((await staff('/api/login', { method: 'POST', body: { login: 'staff1', password: 'secret1' } })).status, 200);
  assert.equal((await staff('/api/me')).data.user.role, 'staff');
});

test('店主は2名、スタッフは20名まで', async () => {
  assert.equal((await owner('/api/users', { method: 'POST', body: { login: 'tencho2', name: '店主2', password: 'secret1', role: 'owner' } })).status, 200);
  const third = await owner('/api/users', { method: 'POST', body: { login: 'tencho3', name: '店主3', password: 'secret1', role: 'owner' } });
  assert.equal(third.status, 400);
  for (let i = 2; i <= 20; i++) {
    assert.equal((await owner('/api/users', { method: 'POST', body: { login: `s${i}`, name: `S${i}`, password: 'secret1' } })).status, 200);
  }
  assert.equal((await owner('/api/users', { method: 'POST', body: { login: 's21', name: 'S21', password: 'secret1' } })).status, 400);
});

test('店主は生体を登録でき、スタッフは価格を変えられない', async () => {
  const r = await owner('/api/items', { method: 'POST', body: { no: '1', species: 'ヒョウモントカゲモドキ', morph: 'ハイポ', price: 12800, category: 'ヤモリ' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.item.status, 'available');
  assert.equal((await owner('/api/items', { method: 'POST', body: { no: '2', species: 'ボールパイソン', price_ask: true } })).status, 200);
  assert.equal((await owner('/api/items', { method: 'POST', body: { no: '3', species: 'コーンスネーク', price: 8000, status: 'hidden' } })).status, 200);
  assert.equal((await owner('/api/items', { method: 'POST', body: { no: '1', species: '重複' } })).status, 409);

  assert.equal((await staff('/api/items/1', { method: 'PATCH', body: { price: 1 } })).status, 403);
  assert.equal((await staff('/api/items', { method: 'POST', body: { species: 'x' } })).status, 403);
  assert.equal((await owner('/api/items/1', { method: 'PATCH', body: { price: 11800 } })).data.item.price, 11800);
});

test('公開サイト：販売中・ASK・非公開の表示', async () => {
  const html = await (await fetch(`${base}/stock`)).text();
  assert.match(html, /ヒョウモントカゲモドキ/);
  assert.match(html, /¥11,800/);
  assert.match(html, /ASK/);
  assert.doesNotMatch(html, /コーンスネーク/); // 非公開
  const hiddenPid = (await owner('/api/items/3')).data.item.pub_id;
  assert.equal((await fetch(`${base}/item/${hiddenPid}`)).status, 404);
  assert.equal((await fetch(`${base}/item/3`)).status, 404); // 管理番号ではページを開けない
  assert.match(await (await fetch(`${base}/`)).text(), /新入荷/);
});

test('スタッフが売約にすると、公開サイトとリアルタイム通知に反映される', async () => {
  const events = [];
  const ctrl = new AbortController();
  const sse = fetch(`${base}/events`, { signal: ctrl.signal }).then(async (res) => {
    const reader = res.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      events.push(new TextDecoder().decode(value));
      if (events.join('').includes('event: item')) break;
    }
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 100));

  const r = await staff('/api/items/1/status', { method: 'POST', body: { status: 'sold' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.item.status, 'sold');
  await Promise.race([sse, new Promise((r2) => setTimeout(r2, 1000))]);
  ctrl.abort();
  const pid = r.data.item.pub_id;
  assert.match(events.join(''), new RegExp(`"pid":"${pid}","status":"sold"`));
  assert.doesNotMatch(events.join(''), /"no"/); // 公開ページへの通知に管理番号は含めない

  const html = await (await fetch(`${base}/stock`)).text();
  assert.match(html, /売約済み/);
  const onlyAvail = await (await fetch(`${base}/stock?sold=0`)).text();
  assert.doesNotMatch(onlyAvail, /ヒョウモントカゲモドキ/);

  // 取り消し（販売中に戻す）
  assert.equal((await staff('/api/items/1/status', { method: 'POST', body: { status: 'available' } })).data.item.sold_at, null);
  const logs = (await owner('/api/logs')).data.logs;
  assert.ok(logs.some((l) => l.action === 'status' && l.user_name === 'スタッフ1'));
});

test('取り込み：プレビューして上書き・新規', async () => {
  const form = new FormData();
  form.append('text', 'No.1 ヒョウモントカゲモドキ ハイポ ♂ 9,800円\nNo.50 フトアゴヒゲトカゲ レザーバック ♀ ヤング ASK');
  const cookie = await (async () => { // owner の Cookie を取り出すため再ログイン
    const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'X-Requested-With': 'es-staff', 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'tencho', password: 'secret1' }) });
    return res.headers.get('set-cookie').split(';')[0];
  })();
  const prev = await (await fetch(`${base}/api/import/preview`, { method: 'POST', headers: { 'X-Requested-With': 'es-staff', Cookie: cookie }, body: form })).json();
  assert.equal(prev.rows.length, 2);
  assert.equal(prev.rows[0]._exists, true);
  assert.equal(prev.rows[1].price_ask, true);
  const r = await owner('/api/import/commit', { method: 'POST', body: { rows: prev.rows } });
  assert.deepEqual([r.data.created, r.data.updated], [1, 1]);
  assert.equal((await owner('/api/items/1')).data.item.price, 9800);
  assert.equal((await owner('/api/items/50')).data.item.category, 'トカゲ');
  assert.equal((await staff('/api/import/commit', { method: 'POST', body: { rows: prev.rows } })).status, 403);
});

test('変更系 API はカスタムヘッダーがないと拒否（CSRF 対策）', async () => {
  const res = await fetch(`${base}/api/items/1/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"status":"sold"}' });
  assert.equal(res.status, 403);
});

test('文章の読み取り', () => {
  assert.deepEqual(parsePrice('4.5万円'), { price: 45000, price_ask: false });
  assert.deepEqual(parsePrice('応相談'), { price: null, price_ask: true });
  const r = parseLine('No.102 ヒョウモントカゲモドキ（マックスノー エクリプス） ♀ 約10cm 18,000円(税込)');
  assert.equal(r.no, '102');
  assert.equal(r.morph, 'マックスノー エクリプス');
  assert.equal(r.sex, 'メス');
  assert.equal(r.price, 18000);
  const t = parseText('【新入荷】\n\n管理番号：7\n種名：ギリシャリクガメ\n価格：ASK\n');
  assert.equal(t.rows.length, 1);
  assert.equal(t.rows[0].category, '陸ガメ');
  assert.equal(parseLine('No.9 パンサーカメレオン ♂ 30000円').category, 'カメレオン・ヒメカメレオン');
  assert.equal(parseLine('No.10 ヒョウモントカゲモドキ ♂ 9800円').category, 'トカゲモドキ');
  assert.equal(parseLine('No.11 アカメカブトトカゲ ♀ 9800円').category, 'トカゲ');
});

test('取り込み：番号なしの行の自動採番が、同じリスト内の番号とぶつからない', async () => {
  const before = (await owner('/api/items?limit=500')).data.items.length;
  const r = await owner('/api/import/commit', { method: 'POST', body: { rows: [{ species: 'クレステッドゲッコー', price: 1 }, { no: '900', species: 'ギリシャリクガメ', price_ask: true }] } });
  assert.deepEqual([r.data.created, r.data.updated], [2, 0]);
  assert.equal((await owner('/api/items?limit=500')).data.items.length, before + 2);
  assert.equal((await owner('/api/items/901')).data.item.species, 'クレステッドゲッコー');
});

test('robots.txt と sitemap.xml（販売中の個体だけ載る）', async () => {
  const robots = await (await fetch(`${base}/robots.txt`)).text();
  assert.match(robots, /Disallow: \/staff\//);
  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  const pid1 = (await owner('/api/items/1')).data.item.pub_id;
  const pid3 = (await owner('/api/items/3')).data.item.pub_id;
  assert.match(sitemap, new RegExp(`/item/${pid1}<`));
  assert.doesNotMatch(sitemap, new RegExp(`/item/${pid3}<`)); // 非公開
});

test('バックアップを作成できる', () => {
  const { backupNow } = require('../src/backup');
  const file = backupNow();
  assert.ok(fs.statSync(file).size > 0);
});

test('生体の買取・下取りページ', async () => {
  const res = await fetch(`${base}/kaitori`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /買取・下取り/);
});

test('お客様側では管理番号が見えず、管理番号で検索もできない', async () => {
  await owner('/api/items', { method: 'POST', body: { no: '7777', species: 'ボールパイソン', morph: 'パステル', price: 30000 } });
  const list = await (await fetch(`${base}/stock`)).text();
  assert.doesNotMatch(list, /7777/);
  assert.doesNotMatch(await (await fetch(`${base}/stock?q=7777`)).text(), /パステル/);
  assert.match(await (await fetch(`${base}/stock?q=${encodeURIComponent('パステル')}`)).text(), /パステル/);
  const it = (await owner('/api/items/7777')).data.item;
  const detail = await (await fetch(`${base}/item/${it.pub_id}`)).text();
  assert.doesNotMatch(detail, /7777/);
  assert.match(detail, new RegExp(it.pub_id));
  // スタッフはお問い合わせコードでも探せる
  assert.equal((await staff(`/api/items?q=${it.pub_id}`)).data.items[0].no, '7777');
});

test('販売済みにするとサイトから消える', async () => {
  const it = (await owner('/api/items/7777')).data.item;
  assert.equal((await staff('/api/items/7777/status', { method: 'POST', body: { status: 'sold' } })).data.item.status, 'sold');
  assert.match(await (await fetch(`${base}/stock`)).text(), new RegExp(it.pub_id));
  const done = await staff('/api/items/7777/status', { method: 'POST', body: { status: 'done' } });
  assert.equal(done.data.item.status, 'done');
  assert.ok(done.data.item.done_at);
  assert.doesNotMatch(await (await fetch(`${base}/stock`)).text(), new RegExp(it.pub_id));
  assert.equal((await fetch(`${base}/item/${it.pub_id}`)).status, 404);
});
