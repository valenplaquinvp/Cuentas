// Cuentas Claras — funciona sin internet. Subí el número de versión cuando cambies archivos.
const CACHE = 'cuentas-v4';
const ASSETS = ['./', './index.html', './parser.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // red primero (para recibir actualizaciones), caché si no hay señal
    e.respondWith(fetch(req).then(res => {
      if (!res.ok) return res;
      const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return res;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req, {ignoreSearch: true}).then(hit => hit || fetch(req).then(res => {
    if (!res.ok) return res;
    const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
  })));
});
