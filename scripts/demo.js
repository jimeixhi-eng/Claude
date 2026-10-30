'use strict';
// 店舗に見せるためのデモ起動： npm run demo
// demo-data/ にサンプル在庫とアカウントを作ってから起動する（本番のデータには触れない）。
const path = require('node:path');
const fs = require('node:fs');
process.env.DATA_DIR ||= path.join(__dirname, '..', 'demo-data');

const { db, saveSettings } = require('../src/db');
const auth = require('../src/auth');
const items = require('../src/items');
const { parseAny } = require('../src/importer');
const app = require('../server');

(async () => {
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n === 0) {
    const add = db.prepare('INSERT INTO users(login, name, role, pass_hash) VALUES(?, ?, ?, ?)');
    add.run('tencho', '店主', 'owner', auth.hashPassword('demo1234'));
    add.run('staff1', 'スタッフ', 'staff', auth.hashPassword('demo1234'));
    const owner = { id: 1, name: '店主', role: 'owner' };
    for (const f of ['blog-sample.txt', 'list-sample.csv', 'list-sample.xlsx']) {
      const file = path.join(__dirname, '..', 'samples', f);
      const { rows } = await parseAny({ buffer: fs.readFileSync(file), filename: f });
      items.importRows(owner, rows.map(({ _warnings, ...r }) => r));
    }
    saveSettings({
      address: '（デモ）東京都〇〇区〇〇 1-2-3', hours: '13:00〜20:00', holidays: '毎週水曜日', phone: '03-0000-0000',
      lineUrl: 'https://line.me/', lineId: '@exoticsupply', notice: 'これはデモ表示です',
      regNo: '（デモ）動販 第000000号', regDate: '2024年4月1日', regExpiry: '2029年3月31日', manager: '（デモ）山田 太郎',
    });
    console.log('デモデータを作成しました');
  }
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`\n公開サイト    http://localhost:${port}/`);
    console.log(`スタッフアプリ http://localhost:${port}/staff/`);
    console.log('  店主     ID: tencho  パスワード: demo1234');
    console.log('  スタッフ ID: staff1  パスワード: demo1234\n');
  });
})();
