// Offline support: network first, falling back to the cached copy.
const CACHE = 'mesora-v7';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './js/app.js',
  './js/assistant.js',
  './js/audio.js',
  './js/camera.js',
  './js/db.js',
  './js/dmx.js',
  './js/exporter.js',
  './js/framestore.js',
  './js/grading.js',
  './js/history.js',
  './js/learn.js',
  './js/library.js',
  './js/lipsync.js',
  './js/media.js',
  './js/migrate.js',
  './js/moco.js',
  './js/monitor.js',
  './js/platform.js',
  './js/projectio.js',
  './js/rig.js',
  './js/review.js',
  './js/shortcuts.js',
  './js/timeline.js',
  './js/timing.js',
  './js/util.js',
  './js/viewer.js',
  './js/viewer-gl.js',
  './js/xsheet.js',
  './js/zip.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })),
  );
});
