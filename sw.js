/* 그림책 공방 오프라인 캐시
   - 페이지 이동: 네트워크 먼저, 안 되면 캐시
   - 같은 사이트 파일: 캐시 먼저 쓰고 뒤에서 갱신 (stale-while-revalidate)
   - jsDelivr(음성 엔진): 캐시 먼저
   - Hugging Face(AI 목소리 모델): 건드리지 않음. tts.js 가 Cache Storage 에 직접 보관한다
   - 같은 사이트 응답에 COOP/COEP 를 붙여 교차 출처 격리를 켠다 → 음성 엔진이 CPU 여러 코어를 쓴다
   고칠 때마다 CACHE 버전을 올린다 */
var CACHE = 'storylab-shell-v7';
var SHELL = [
  './', './index.html', './css/app.css', './css/db-tokens.css', './fonts/pretendard.css', './js/core.js', './js/stories.js', './js/scenes.js', './js/app.js',
  './js/tts-client.js', './js/tts-worker.js', './js/tts.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './licenses/OpenRAIL-M.txt', './licenses/onnxruntime-MIT.txt', './licenses/Supertonic-code-MIT.txt', './licenses/Supertonic3-int8-MODIFICATIONS.md'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('storylab-shell-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function isolate(res) {
  if (!res || res.type === 'opaque' || res.status === 0) return res;
  var h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
function put(req, res) {
  if (res && res.ok && res.type !== 'opaque') {
    var copy = res.clone();
    caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(function () { });
  }
  return res;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      e.respondWith(fetch(req).then(function (res) { return put(req, res); }).catch(function () {
        return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('./index.html'); });
      }).then(isolate));
      return;
    }
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) { return put(req, res); });
      if (hit) { net.catch(function () { }); return hit; }
      return net;
    }).then(isolate));
    return;
  }
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) { return put(req, res); });
    }));
  }
});
