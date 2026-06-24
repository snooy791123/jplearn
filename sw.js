// LinguaMode Service Worker — 離線支援（v2：HTML 網路優先，避免卡舊版）
// 策略：
//   - HTML / 導覽請求：網路優先（永遠拿最新版；沒網路才用快取）→ 更新會立即生效
//   - 圖示等靜態資源：快取優先（省流量、離線可用）
//   - API / 外部服務：永遠走網路，不快取（要即時、且含 key 不該被快取）

const CACHE_NAME = 'linguamode-v2';
const APP_SHELL = [
  './',
  './index.html',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // API / 外部服務：永遠連網，不快取
  const isApi =
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('generativelanguage');
  if (isApi) return; // 交給瀏覽器預設（直接連網）

  // HTML / 導覽請求：網路優先
  const isHTML =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html') ||
    url.pathname.endsWith('.html') ||
    url.pathname === '/' || url.pathname.endsWith('/');

  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // 成功拿到最新版 → 更新快取備份
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put('./index.html', clone));
          }
          return res;
        })
        .catch(() =>
          // 沒網路 → 用快取的 index.html
          caches.match('./index.html').then((c) => c || caches.match(req))
        )
    );
    return;
  }

  // 其他靜態資源（圖示、manifest）：快取優先
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && url.origin === location.origin) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
