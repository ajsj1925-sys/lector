/* Lector · service worker: funciona sin conexión y recibe archivos compartidos (Android). */
importScripts('js/db.js');
const CACHE = 'lector-v0.4.1';
const LIBS = 'lector-libs-v1'; // librerías externas (Telegram), versionadas: se guardan para usarlas sin conexión
const SHELL = ['./', 'index.html', 'css/app.css', 'js/db.js', 'js/zip.js', 'js/demo.js', 'js/addons.js', 'js/reader.js', 'js/player.js', 'js/app.js', 'js/formats.js', 'js/subs.js', 'js/mkv.js', 'js/space.js', 'js/meta.js', 'js/catalog.js', 'js/backup.js', 'js/tg.js', 'js/notify.js',
  'vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js', 'vendor/libarchive/libarchive.js', 'vendor/libarchive/worker-bundle.js', 'vendor/libarchive/libarchive.wasm', 'vendor/mp4-muxer.min.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== LIBS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Compartir → Lector: guardamos los archivos y abrimos la app, que los importa
  if (e.request.method === 'POST' && url.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const keys = await DB.getKV('shared', []);
      for (const f of form.getAll('files')) {
        const key = 'share-' + DB.uid();
        await DB.put('files', { key, blob: f, name: f.name, type: f.type });
        keys.push(key);
      }
      await DB.setKV('shared', keys);
      return Response.redirect('./?share=1', 303);
    })());
    return;
  }
  if (e.request.method === 'GET' && url.hostname === 'esm.sh') {
    e.respondWith(caches.open(LIBS).then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // App: primero red (para recibir actualizaciones), si no hay conexión, caché.
  // cache:'no-cache' obliga a preguntar al servidor: si no, el navegador da la copia vieja hasta 10 min (GitHub Pages)
  e.respondWith(fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' }).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
