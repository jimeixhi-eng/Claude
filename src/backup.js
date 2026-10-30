'use strict';
// 毎日の自動バックアップ。data/backups/ に日付ごとのファイルを作り、古いものは自動で消す。
const fs = require('node:fs');
const path = require('node:path');
const { db, DATA_DIR } = require('./db');

const DIR = path.join(DATA_DIR, 'backups');
const KEEP = Number(process.env.BACKUP_KEEP_DAYS || 30);

function backupNow() {
  fs.mkdirSync(DIR, { recursive: true });
  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const file = path.join(DIR, `exotic-supply-${day}.db`);
  if (fs.existsSync(file)) fs.unlinkSync(file); // 同じ日のものは最新で置き換える
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const old = fs.readdirSync(DIR).filter((f) => /^exotic-supply-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(KEEP);
  for (const f of old) fs.unlinkSync(path.join(DIR, f));
  return file;
}

function scheduleBackups() {
  const run = () => { try { backupNow(); } catch (e) { console.error('バックアップに失敗しました', e); } };
  setTimeout(run, 60e3).unref(); // 起動の1分後
  setInterval(run, 6 * 3600e3).unref(); // 以降6時間ごと（1日1ファイル）
}

module.exports = { backupNow, scheduleBackups, BACKUP_DIR: DIR };
