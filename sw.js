// Guarda la app y los mapas vistos para que funcione sin señal.
// Al publicar cambios en la app hay que subir VERSION: así los celulares descargan la nueva.
const VERSION = 'recorrido-v1.1.1';
const APP = [
  './', 'index.html', 'admin.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/geo.js', 'js/store.js', 'js/api.js', 'js/fotos.js', 'js/dxf.js', 'js/iconos.js', 'js/camara.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png',
  'icons/icono-192.png', 'icons/icono-512.png',
];
const TESELAS = 'teselas-v1';
const MAX_TESELAS = 6000;

self.addEventListener('install', (e) => {
  // cache: 'reload' evita copiar archivos viejos de la caché HTTP del navegador
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k !== TESELAS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // hoja del proyecto: siempre en línea (la app guarda su propia copia)
  if (/script\.google(usercontent)?\.com$|googleusercontent\.com$/.test(url.hostname)) return;

  if (/arcgisonline\.com$|tile\.openstreetmap\.org$/.test(url.hostname)) {
    e.respondWith(caches.open(TESELAS).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      try {
        const r = await fetch(e.request);
        if (r.ok || r.type === 'opaque') { c.put(e.request, r.clone()); recortar(c); }
        return r;
      } catch { return new Response('', { status: 504 }); }
    }));
    return;
  }

  if (url.origin === location.origin) {
    // la app: responde con lo guardado y actualiza por detrás
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      const red = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || red;
    }));
  }
});

let recortando = false;
async function recortar(c) {
  if (recortando) return;
  recortando = true;
  const ks = await c.keys();
  for (let i = 0; i < ks.length - MAX_TESELAS; i++) await c.delete(ks[i]);
  recortando = false;
}
