const CACHE = 'mc-v33-network-first';
const ASSETS = ['./index.html', './mc-manifest.json', './do-app.js', './ascent-app.js', './communic8-app.js'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Cache each asset separately -- addAll() is all-or-nothing, so one
      // failed request would silently abort the whole install and block
      // "Add to Home Screen" with no visible error.
      // cache:'reload' skips the browser's HTTP cache so we never store a stale copy.
      Promise.all(
        ASSETS.map((url) =>
          fetch(new Request(url, { cache: 'reload' }))
            .then((res) => { if (res.ok) return cache.put(url, res); })
            .catch((err) => {
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

// Network-first: always try for the latest version, fall back to the cache
// only when offline. Updates show up on the next open without bumping CACHE.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const sameOrigin = new URL(e.request.url).origin === self.location.origin;
  if (!sameOrigin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((cached) => cached || caches.match('./index.html')))
  );
});
