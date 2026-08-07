// Service Worker for 時間割管理 PWA
const CACHE_NAME = 'timetable-v97';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// インストール時：静的アセットをキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// アクティベート時：古いキャッシュを削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// フェッチ時：Network First（オンライン優先）、失敗時はキャッシュ
self.addEventListener('fetch', (event) => {
  // POST リクエストはキャッシュしない
  if (event.request.method !== 'GET') return;

  // chrome-extension や外部リクエストはスキップ
  if (!event.request.url.startsWith(self.location.origin)) return;

  const url = new URL(event.request.url);

  // 同期API等は常にネットワーク（キャッシュすると古いデータを掴む）
  if (url.pathname.startsWith('/api/')) return;

  // ビルド成果物(/assets/*)は内容ハッシュ付きで不変。
  // キャッシュ優先にして2回目以降の起動を即座にする（スマホで効く）。
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 成功したレスポンスをキャッシュに保存
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // オフライン時はキャッシュから返す
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // HTMLリクエストはindex.htmlにフォールバック
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('./index.html');
          }
        });
      })
  );
});
