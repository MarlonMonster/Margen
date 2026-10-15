/* Margen service worker: keeps the app and every data file you have used, so it opens with no signal. */
const SHELL = 'margen-shell-c9cda9fe89';
const FILES = ["./","index.html","app.css","app.js","vocab.js","engine.js","shim.js","icon.svg","icon-180.png","icon-192.png","icon-512.png","manifest.webmanifest","links.json","texts/index.json","texts/el-tiempo-y-las-estaciones.json","texts/en-el-mercado.json","texts/en-el-restaurante.json","texts/en-la-farmacia.json","texts/la-casa-de-pablo.json","texts/la-familia-de-pedro.json","texts/me-llamo-ana.json","texts/mi-dia.json","texts/mi-rutina-diaria.json","texts/mis-vacaciones-en-la-costa.json","texts/un-viaje-en-tren.json","texts/una-casa-nueva.json"];
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
