// TEMPO 本体をキャッシュしてオフラインでも起動できるようにする(範囲は tempo/ の中だけ)。
// 更新したら VERSION、app.js の APP_VERSION、index.html の ?v= を同じ番号に上げること。
const VERSION = 2;
const PREFIX = 'tempo-v';
const CACHE = `${PREFIX}${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  `./style.css?v=${VERSION}`,
  `./app.js?v=${VERSION}`,
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

// 同じサイトのはよ寝てやのキャッシュは消さない(自分の古い版だけ消す)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Google Fonts は版に関係なく残す専用のキャッシュに入れ、オフラインでも同じフォントで表示する
const FONT_CACHE = 'tempo-fonts';

function fontResponse(request) {
  const url = new URL(request.url);
  // フォントのファイル(gstatic)は URL ごとに中身が変わらないのでキャッシュ優先、CSS はネットワーク優先
  if (url.hostname === 'fonts.gstatic.com') {
    return caches.open(FONT_CACHE).then((c) => c.match(request).then((hit) => hit || fetch(request).then((res) => {
      if (res.ok) c.put(request, res.clone());
      return res;
    })));
  }
  return fetch(request)
    .then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(FONT_CACHE).then((c) => c.put(request, copy));
      }
      return res;
    })
    .catch(() => caches.match(request));
}

// ネットワーク優先(更新をすぐ反映)、オフライン時はキャッシュ
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const host = new URL(event.request.url).hostname;
  if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') {
    event.respondWith(fontResponse(event.request));
    return;
  }
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
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
