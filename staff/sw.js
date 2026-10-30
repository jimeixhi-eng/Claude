// スタッフアプリの Service Worker。
// アプリの画面（HTML/JS/CSS）を端末に保存しておき、起動を一瞬にする。在庫データは常にサーバーから取る。
const CACHE = 'es-staff-v1';
const SHELL = ['/staff/', '/staff/app.js', '/staff/app.css', '/staff/manifest.webmanifest', '/img/icon.svg', '/staff/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/events') return;
  if (SHELL.includes(url.pathname) || url.pathname === '/staff/index.html') {
    // 手元の保存分をすぐ返し、裏で最新版に更新（次回起動時に反映）
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const key = url.pathname === '/staff/index.html' ? '/staff/' : url.pathname;
      const cached = await c.match(key);
      const fresh = fetch(e.request).then((r) => { if (r.ok) c.put(key, r.clone()); return r; }).catch(() => cached);
      return cached || fresh;
    }));
  } else if (url.pathname.startsWith('/uploads/')) {
    e.respondWith(caches.open(CACHE + '-img').then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
  }
});
