// LinguaMode Service Worker — 離線支援
// 策略：app 殼層（HTML、圖示）快取優先，可離線開啟並複習已存的字；
//       API 呼叫（/api/、Google Script、外部 AI）一律走網路，不快取（要即時）。

const CACHE_NAME = 'linguamode-v1';
const APP_SHELL = [
  './',
  './index.html',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './manifest.json'
];

// 安裝：預先快取 app 殼層
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

// 啟用：清掉舊版快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 攔截請求
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 只處理 GET
  if (event.request.method !== 'GET') return;

  // API / 外部服務：永遠走網路，絕不快取（要即時、且有 API key 不該被快取）
  const isApi =
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('generativelanguage');
  if (isApi) {
    return; // 交給瀏覽器預設行為（直接連網）
  }

  // app 殼層與靜態資源：快取優先，網路為輔
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // 背景更新（拿到新版下次用）
        fetch(event.request).then((res) => {
          if (res && res.status === 200) {
            caches.open(CACHE_NAME).then((c) => c.put(event.request, res.clone()));
          }
        }).catch(() => {});
        return cached;
      }
      // 沒快取就連網，順便存起來
      return fetch(event.request).then((res) => {
        if (res && res.status === 200 && url.origin === location.origin) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return res;
      }).catch(() => {
        // 離線且沒快取：若是頁面請求，回傳首頁殼層
        if (event.request.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});
