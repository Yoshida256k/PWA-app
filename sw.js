// アプリ本体をキャッシュしてオフラインでも起動できるようにする。
// ファイルを更新したら、CACHE と index.html の ?v= を同じ番号に上げること。
// (?v= があることで、新しい index.html は必ず新しい JS/CSS を読む。古い JS と混ざらない)
const VERSION = 8;
const CACHE = `oyasumi-rta-v${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  `./style.css?v=${VERSION}`,
  `./app.js?v=${VERSION}`,
  `./analysis.js?v=${VERSION}`,
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' でブラウザの HTTP キャッシュ(GitHub Pages は10分)を通さずに取得する
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ネットワーク優先(更新をすぐ反映)、オフライン時はキャッシュ
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' }) // 毎回サーバーに更新を確認(古い HTTP キャッシュを使わない)
      .then((res) => {
        if (res.ok && new URL(event.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('./index.html')))
  );
});
