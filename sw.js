/*
 * Service Worker — オフライン対応
 * 静的ファイルはキャッシュ優先(cache-first)。
 * data/questions.json はネットワーク優先(network-first)→失敗時にキャッシュへフォールバック。
 *   日次ドリル問題を追記した最新版を優先しつつ、オフラインでも学習を続けられるようにする。
 */
var CACHE = 'scapp-v3';
var CORE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './data/questions.json',
  './data/cards.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf('scapp-') === 0 && k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var isQuestions = url.pathname.endsWith('/data/questions.json') || url.pathname.endsWith('data/questions.json');

  if (isQuestions) {
    // network-first
    e.respondWith(
      fetch(req).then(function (res) {
        if (!res.ok) throw new Error('問題データの取得に失敗しました');
        var copy = res.clone();
        return caches.open(CACHE).then(function (c) {
          return c.put(req, copy);
        }).catch(function () { /* キャッシュ保存失敗時もオンラインのデータは利用する */ })
          .then(function () { return res; });
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./data/questions.json');
        });
      })
    );
    return;
  }

  // cache-first(静的ファイル)
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        // ナビゲーション要求のオフライン時は index.html を返す
        if (req.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});
