// Bump CACHE when you deploy changes so phones pick up the new version.
const CACHE = 'inspections-v9';
const SHELL = ['./', './index.html', './styles.css', './db.js', './pdf.js', './app.js', './checklists.json',
  './manifest.webmanifest', './vendor/jspdf.umd.min.js', './vendor/jspdf.plugin.autotable.min.js',
  './assets/atlantic-logo-white.png', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // Network-first for the checklist config so edits show up when online; cache-first for everything else.
  if (e.request.url.endsWith('checklists.json')) {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
    return r;
  })));
});
