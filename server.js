'use strict';
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { db, DATA_DIR, ROLE_LIMITS, getSettings, saveSettings } = require('./src/db');
const auth = require('./src/auth');
const items = require('./src/items');
const views = require('./src/views');
const realtime = require('./src/realtime');
const importer = require('./src/importer');
const { scheduleBackups } = require('./src/backup');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ---------- 静的ファイル ----------
app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads'), { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
// スタッフアプリ本体は常に最新を取りに行く（Service Worker が手元に保存するので起動は速い）
app.use('/staff', express.static(path.join(__dirname, 'staff'), { maxAge: 0, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

// ---------- 公開サイト ----------
const html = (res, body, status = 200) => res.status(status).type('html').setHeader('Cache-Control', 'no-cache').send(body);
app.get('/', (req, res) => html(res, views.home(getSettings())));
app.get('/stock', (req, res) => html(res, views.stock(getSettings(), req.query)));
app.get('/shop', (req, res) => html(res, views.shop(getSettings())));
app.get('/category', (req, res) => html(res, views.categoryPage(getSettings())));
app.get('/kaitori', (req, res) => html(res, views.buyback(getSettings())));
app.get('/item/:pid', (req, res) => {
  const it = items.getByPubId(req.params.pid);
  if (!it || it.status === 'hidden' || it.status === 'done') return html(res, views.notFound(getSettings()), 404);
  html(res, views.detail(getSettings(), it));
});
app.get('/events', (req, res) => realtime.subscribe(req, res)); // 公開ページ向け（管理番号は含まない）

// 検索エンジン向け
const siteUrl = (req) => (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /staff/\nDisallow: /api/\nSitemap: ${siteUrl(req)}/sitemap.xml\n`);
});
app.get('/sitemap.xml', (req, res) => {
  const base = siteUrl(req);
  const urls = ['/', '/category', '/stock', '/kaitori', '/shop', ...items.listPublic({ status: 'available' }).map((it) => `/item/${it.pub_id}`)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${views.esc(base + u)}</loc></url>`).join('\n')}\n</urlset>\n`);
});

// ---------- スタッフ用 API ----------
const api = express.Router();
const wrap = (fn) => (req, res, next) => { try { const r = fn(req, res); if (r?.catch) r.catch(next); } catch (e) { next(e); } };

api.get('/setup-needed', (req, res) => res.json({ needed: db.prepare('SELECT COUNT(*) n FROM users').get().n === 0 }));

api.post('/setup', wrap((req, res) => {
  if (req.get('X-Requested-With') !== 'es-staff') return res.status(403).end();
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) return res.status(409).json({ error: '初期設定は完了しています' });
  const { login, name, password } = req.body || {};
  validateUser({ login, name, password });
  const info = db.prepare('INSERT INTO users(login, name, role, pass_hash) VALUES(?, ?, ?, ?)').run(login.trim(), name.trim(), 'owner', auth.hashPassword(password));
  auth.setSessionCookie(res, auth.createSession(info.lastInsertRowid), req);
  res.json({ ok: true });
}));

api.post('/login', wrap((req, res) => {
  if (req.get('X-Requested-With') !== 'es-staff') return res.status(403).end();
  if (!auth.loginAllowed(req.ip)) return res.status(429).json({ error: 'しばらく時間をおいてお試しください' });
  const { login, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE login = ? AND active = 1').get(String(login || '').trim());
  if (!u || !auth.verifyPassword(String(password || ''), u.pass_hash)) return res.status(401).json({ error: 'IDまたはパスワードが違います' });
  auth.setSessionCookie(res, auth.createSession(u.id), req);
  res.json({ ok: true });
}));

api.post('/logout', (req, res) => {
  auth.destroySession(auth.parseCookies(req.headers.cookie)[auth.COOKIE]);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

api.use(auth.requireUser);
api.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

api.get('/events', (req, res) => realtime.subscribe(req, res, { staff: true }));
api.get('/me', (req, res) => res.json({ user: req.user, limits: ROLE_LIMITS, categories: getSettings().categories }));
api.get('/stats', (req, res) => res.json(items.todayStats()));
api.get('/items', (req, res) => res.json({ items: items.listStaff(req.query) }));
api.get('/items/:no', (req, res) => {
  const it = items.getByNo(req.params.no);
  it ? res.json({ item: it }) : res.status(404).json({ error: `管理番号 ${req.params.no} は見つかりません` });
});
api.post('/items/:no/status', wrap((req, res) => res.json({ item: items.setStatus(req.user, req.params.no, req.body?.status) })));

// ここから下は店主のみ
api.get('/next-no', auth.requireOwner, (req, res) => res.json({ no: items.nextNo() }));
api.post('/items', auth.requireOwner, wrap((req, res) => res.json({ item: items.create(req.user, req.body || {}) })));
api.patch('/items/:no', auth.requireOwner, wrap((req, res) => res.json({ item: items.update(req.user, req.params.no, req.body || {}) })));
api.delete('/items/:no', auth.requireOwner, wrap((req, res) => { items.remove(req.user, req.params.no); res.json({ ok: true }); }));
api.post('/items/:no/photos', auth.requireOwner, upload.single('photo'), wrap((req, res) => {
  const it = items.getByNo(req.params.no);
  if (!it) return res.status(404).json({ error: '見つかりません' });
  if (!req.file || !/^image\/(jpeg|png|webp|gif)$/.test(req.file.mimetype)) return res.status(400).json({ error: '画像ファイルを選んでください' });
  const url = importer.saveUpload(req.file.buffer, req.file.mimetype.split('/')[1]);
  res.json({ item: items.update(req.user, it.no, { photos: [...it.photos, url] }) });
}));

api.post('/import/preview', auth.requireOwner, upload.single('file'), wrap(async (req, res) => {
  const { categories } = getSettings();
  const text = req.body?.text;
  if (!req.file && !text) return res.status(400).json({ error: 'ファイルを選ぶか、文章を貼り付けてください' });
  const result = await importer.parseAny({ buffer: req.file?.buffer, filename: req.file?.originalname, text: req.file ? undefined : text, categories });
  for (const r of result.rows) r._exists = !!(r.no && items.getByNo(r.no));
  res.json(result);
}));
api.post('/import/commit', auth.requireOwner, wrap((req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: '取り込む行がありません' });
  res.json(items.importRows(req.user, rows.map(({ _warnings, _exists, ...r }) => r), { newStatus: req.body.newStatus === 'hidden' ? 'hidden' : 'available' }));
}));

api.get('/logs', auth.requireOwner, (req, res) => res.json({ logs: items.recentLogs(200) }));
api.get('/settings', auth.requireOwner, (req, res) => res.json({ settings: getSettings() }));
api.put('/settings', auth.requireOwner, wrap((req, res) => {
  const s = saveSettings(req.body || {});
  realtime.broadcast('reload', { reason: 'settings' });
  res.json({ settings: s });
}));

// スタッフアカウント管理（店主2名・スタッフ20名まで）
function validateUser({ login, name, password }, { requirePassword = true } = {}) {
  if (!/^[a-zA-Z0-9_.-]{2,32}$/.test(String(login || '').trim())) throw new items.HttpError(400, 'IDは半角英数字2〜32文字で入力してください');
  if (!String(name || '').trim()) throw new items.HttpError(400, '表示名を入力してください');
  if ((requirePassword || password) && String(password || '').length < 6) throw new items.HttpError(400, 'パスワードは6文字以上にしてください');
}
const activeCount = (role) => db.prepare('SELECT COUNT(*) n FROM users WHERE role = ? AND active = 1').get(role).n;
function assertRoom(role) {
  if (!ROLE_LIMITS[role]) throw new items.HttpError(400, '権限が不正です');
  if (activeCount(role) >= ROLE_LIMITS[role]) throw new items.HttpError(400, `${role === 'owner' ? '店主' : 'スタッフ'}は最大${ROLE_LIMITS[role]}名までです`);
}

api.get('/users', auth.requireOwner, (req, res) => {
  res.json({ users: db.prepare('SELECT id, login, name, role, active, created_at FROM users ORDER BY role, id').all(), limits: ROLE_LIMITS });
});
api.post('/users', auth.requireOwner, wrap((req, res) => {
  const { login, name, password, role = 'staff' } = req.body || {};
  validateUser({ login, name, password });
  assertRoom(role);
  if (db.prepare('SELECT 1 FROM users WHERE login = ?').get(login.trim())) throw new items.HttpError(409, 'そのIDは既に使われています');
  db.prepare('INSERT INTO users(login, name, role, pass_hash) VALUES(?, ?, ?, ?)').run(login.trim(), name.trim(), role, auth.hashPassword(password));
  res.json({ ok: true });
}));
api.patch('/users/:id', auth.requireOwner, wrap((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: '見つかりません' });
  const { name, password, role, active } = req.body || {};
  const nextRole = role ?? u.role;
  const nextActive = active === undefined ? u.active : active ? 1 : 0;
  if ((nextRole !== u.role || (nextActive && !u.active)) && nextActive) assertRoom(nextRole);
  if (u.role === 'owner' && (nextRole !== 'owner' || !nextActive) && activeCount('owner') <= 1) throw new items.HttpError(400, '店主が0名になる変更はできません');
  if (password) validateUser({ login: u.login, name: name ?? u.name, password });
  db.prepare('UPDATE users SET name = ?, role = ?, active = ?, pass_hash = ? WHERE id = ?')
    .run(String(name ?? u.name).trim(), nextRole, nextActive, password ? auth.hashPassword(password) : u.pass_hash, u.id);
  if (!nextActive || password) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  res.json({ ok: true });
}));

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((req, res) => html(res, views.notFound(getSettings()), 404));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error(err);
  if (req.path.startsWith('/api')) return res.status(status).json({ error: status >= 500 ? 'サーバーでエラーが発生しました' : err.message });
  res.status(status).send('エラーが発生しました');
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  scheduleBackups();
  app.listen(port, () => console.log(`エキゾチックサプライ: http://localhost:${port}  （スタッフアプリ: /staff/）`));
}

module.exports = app;
