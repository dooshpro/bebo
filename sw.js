const CACHE = 'bebo-v1';
const FONT_CACHE = 'bebo-fonts';

const FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './favicon.png',
  './cat/lut.png',
  './cat/men.png',
  './cat/fol.png',
  './cat/ovu.png',
  './cat/lat.png',
  './icon/set.png',
  './icon/cal.png',
  './icon/back.png',
  './icon/prev.png',
  './icon/next.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all(
        FILES.map(file => cache.add(file).catch(() => console.warn('not cached:', file)))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE && key !== FONT_CACHE).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then(res => {
          // page opened with query string never stored
          if (res.ok && !url.search) {
            const copy = res.clone();
            caches.open(CACHE).then(cache => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then(cache =>
        cache.match(req).then(hit => {
          const fresh = fetch(req)
            .then(res => {
              cache.put(req, res.clone());
              return res;
            })
            .catch(() => hit);
          return hit || fresh;
        })
      )
    );
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const open = list.find(client => 'focus' in client);
      return open ? open.focus() : self.clients.openWindow('./');
    })
  );
});