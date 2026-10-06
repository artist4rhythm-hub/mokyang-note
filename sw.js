/* 목자의 삶 — 서비스 워커
   - 앱 화면(html/js/아이콘)만 캐시해서 오프라인에서도 열리게 함
   - Firebase 통신은 절대 캐시하지 않음 (항상 최신 데이터)
   - 파일을 새로 올리면 CACHE 이름을 바꿔 새 버전을 받게 함 */

const CACHE = "mokja-v7";
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (ev) => {
  self.skipWaiting();
  ev.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {}))
  );
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // 우리 사이트 파일이 아니면 건드리지 않음 (Firebase, 구글 폰트 등)
  if (url.origin !== self.location.origin) return;

  // 네트워크 우선 — 새로 올린 파일이 바로 반영되게
  ev.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
  );
});
