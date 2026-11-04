// TEMPO は https://yoshida256k.github.io/PWA-TEMPO/ に移転した。
// 旧URL(PWA-app/tempo/)に残った Service Worker を片付けるための版:
// 自分の古いキャッシュ(tempo-v* / tempo-fonts)を消して登録を解除し、開いている画面を読み込み直す。
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (/^tempo-(v\d+|fonts)$/.test(k)) await caches.delete(k);
    }
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
  })());
});
