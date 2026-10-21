// Работа без сети и обновления. Оболочка приложения лежит в кэше своей версии.
// Новая версия на сайте → новый sw.js → скачивает свежие файлы и ждёт: приложение показывает
// «Доступна новая версия», по кнопке присылает «skip» — тогда новая версия включается, страница перезагружается.
// Имя кэша при сборке заменяется отпечатком файлов (mobile/build.js), поэтому любая правка = новая версия.
// Превью видео (i.ytimg.com) и запросы к YouTube и Google не кэшируются.
const CACHE = 'smotribelno-5c16e5a481';
const SHELL = ['./', './index.html', './app.css', './app.js', './manifest.webmanifest', './icons/192.png', './shared.js', './starhall.css'];

self.addEventListener('install', (e) => {
  // cache: 'reload' — мимо HTTP-кэша браузера, чтобы в новую версию не попали старые файлы
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'skip') self.skipWaiting();
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
  // Открытие из «Поделиться» и после входа в Google приходит с ?… и #… — отдаём ту же страницу
  const key = e.request.mode === 'navigate' ? './index.html' : e.request;
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(key, { ignoreSearch: e.request.mode === 'navigate' });
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) c.put(key, r.clone());
      return r;
    })
  );
});
