/* Margen service worker: keeps the app and every data file you have used, so it opens with no signal. */
const SHELL = 'margen-shell-__VERSION__';
const FILES = __SHELL_FILES__;
self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('margen-shell-') && k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: false });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && /\/data\//.test(req.url)) { const c = await caches.open('margen-data-v1'); c.put(req, res.clone()); }
      return res;
    } catch (err) {
      return (await caches.match(req)) || new Response('Offline', { status: 503 });
    }
  })());
});
