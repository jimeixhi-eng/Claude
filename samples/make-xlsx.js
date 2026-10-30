// サンプル Excel（samples/list-sample.xlsx）を作るスクリプト： node samples/make-xlsx.js
const ExcelJS = require('exceljs');
(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('在庫');
  ws.addRow(['エキゾチックサプライ 在庫リスト']);
  ws.addRow(['No.', '種名', 'モルフ', '性別', 'サイズ', '価格（税込）', '入荷日', '状態']);
  ws.addRow([301, 'ヒョウモントカゲモドキ', 'スーパーマックスノー', '♂', 'ベビー', 15800, new Date('2026-10-28'), '販売中']);
  ws.addRow([302, 'ニシアフリカトカゲモドキ', 'オレオ', '♀', 'ヤング', 22000, new Date('2026-10-28'), '']);
  ws.addRow([303, 'コーンスネーク', 'パルメット', '不明', 'ハッチリング', 'ASK', new Date('2026-10-29'), '']);
  ws.addRow([304, 'パンサーカメレオン', 'アンビロブ', 'オス', '15cm', 48000, new Date('2026-10-01'), '売約']);
  await wb.xlsx.writeFile(__dirname + '/list-sample.xlsx');
  console.log('samples/list-sample.xlsx を作成しました');
})();
