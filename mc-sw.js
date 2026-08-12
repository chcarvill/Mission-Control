const CACHE = 'mc-v21-c8-send-to-do';
const ASSETS = ['./index.html', './mc-manifest.json', './do-app.js'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Cache each asset separately -- addAll() is all-or-nothing, so one
      // failed request would silently abort the whole install and block
      // "Add to Home Screen" with no visible error.
      Promise.all(
        ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('Skipping uncacheable asset during install:', url, err);
          })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
