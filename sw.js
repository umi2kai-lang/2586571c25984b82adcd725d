/*
 * Service Worker — オフライン対応
 * アプリ本体(index.html / app.js / styles.css)と data/*.json はネットワーク優先
 * (network-first)。オンライン時は常に最新を取得し、取得できたらキャッシュへ複製する。
 * オフライン時のみキャッシュへフォールバックする。
 *   → これにより、Android Chrome 等で古い版が居座る問題を避ける。
 * その他の静的ファイル(アイコン・manifest 等)はキャッシュ優先(cache-first)。
 */
var CACHE = 'scapp-v12';
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

// ネットワーク優先で取得し、成功時はキャッシュへ複製。失敗時はキャッシュへフォールバック。
function networkFirst(req) {
  return fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () { /* 保存失敗は無視 */ });
      return res;
    }
    // 5xx/4xx 等でも、キャッシュがあればそれを優先して返す(なければ応答そのまま)。
    return caches.match(req).then(function (hit) { return hit || res; });
  }).catch(function () {
    return caches.match(req).then(function (hit) {
      if (hit) return hit;
      // ナビゲーション要求のオフライン時は index.html を返す
      if (req.mode === 'navigate') return caches.match('./index.html');
      return undefined;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  var p = url.pathname;
  var isApp = req.mode === 'navigate' ||
    p === '/' || p.endsWith('/') ||
    p.endsWith('/index.html') || p.endsWith('index.html') ||
    p.endsWith('/app.js') || p.endsWith('app.js') ||
    p.endsWith('/styles.css') || p.endsWith('styles.css') ||
    /\/data\/[^/]+\.json$/.test(p);

  if (isApp) {
    // network-first(アプリ本体・データ)。古い版の居座りを防ぐ。
    e.respondWith(networkFirst(req));
    return;
  }

  // 設問の図版(data/img/*.webp 等)はファイル名が問題ごとに固有(不変)なので、
  // 実行時キャッシュ(cache-first)で配信する。初回表示後はオフラインでも閲覧可能。
  // 以降の cache-first 分岐がアイコン・manifest と同様にこれを処理する。

  // cache-first(図版・アイコン・manifest 等の静的ファイル)
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
        if (req.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});
