'use strict';
// スタッフ向け手順書の見本（demo/staff-guide.html）を作る： npm run build:guide
// 本番では /staff-guide が実際のアドレスの QR コード付きで同じ内容を出す。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'es-guide-'));
const { getSettings } = require('../src/db');
const { renderGuide } = require('../src/guide');

(async () => {
  const html = await renderGuide(getSettings(), 'https://zaiko.exotic-supply.com/staff/', { fragment: true, sample: true });
  fs.writeFileSync(path.join(__dirname, '..', 'demo', 'staff-guide.html'), html);
  console.log('作成しました: demo/staff-guide.html');
})();
