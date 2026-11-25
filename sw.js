// KORD offline shell. Always asks the network for the newest copy first (skipping the browser's own cache),
// and only falls back to the saved copy when the phone is offline.
const CACHE = 'kord-v3';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', 'app.js', 'data/kord.json'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      const old = keys.filter((k) => k !== CACHE);
      return Promise.all(old.map((k) => caches.delete(k)))
        .then(() => self.clients.claim())
        // only a phone that was showing an older version is refreshed; a first visit is left alone
        .then(() => (old.length ? self.clients.matchAll({ type: 'window' }) : []))
        .then((cs) => cs.forEach((c) => c.navigate(c.url).catch(() => {})));
    })
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
