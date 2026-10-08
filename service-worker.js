// 정적 파일을 변경할 때 CACHE_NAME의 버전도 올려 주세요.
const CACHE_NAME = 'busan-parking-v6-fast-refresh-20261008-8';
const STATIC_FILES = ['./', './index.html', './style.css', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './install-qr.png'];
const STATIC_URLS = new Set(STATIC_FILES.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(STATIC_FILES.map(path => new Request(new URL(path, self.registration.scope), { cache: 'reload' })));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('busan-parking-') && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // API 응답은 저장하지 않고 네트워크로 요청합니다.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const canonical = new URL(url.pathname, url.origin).href;
  if (!STATIC_URLS.has(canonical)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const stored = await cache.match(canonical);
    if (stored) return stored;
    return fetch(event.request);
  })());
});
