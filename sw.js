// Работа без сети: оболочка приложения в кэше, обновляется в фоне при каждом открытии.
// Превью видео (i.ytimg.com) и запросы к YouTube не кэшируются.
const CACHE = 'smotribelno-v3';
const SHELL = ['./', './index.html', './app.css', './app.js', './manifest.webmanifest', './icons/192.png', './shared.js', './starhall.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Открытие из «Поделиться» приходит с ?url=… — отдаём ту же страницу из кэша
  const key = e.request.mode === 'navigate' ? './index.html' : e.request;
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(key, { ignoreSearch: e.request.mode === 'navigate' });
      const net = fetch(e.request)
        .then((r) => {
          if (r.ok) c.put(key, r.clone());
          return r;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
