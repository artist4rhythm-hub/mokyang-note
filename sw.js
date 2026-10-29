/* 목자의 삶 — 서비스 워커
   - 앱 화면(html/js/아이콘)만 캐시해서 오프라인에서도 열리게 함
   - Firebase 통신은 절대 캐시하지 않음 (항상 최신 데이터)
   - 파일을 새로 올리면 CACHE 이름을 바꿔 새 버전을 받게 함 */

const CACHE = "mokja-v18";
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

  // 네트워크 우선 — 새로 올린 파일이 바로 반영되게.
  // 브라우저의 HTTP 캐시가 옛 파일을 내주지 않도록 매번 서버에 '바뀌었나' 물어봅니다
  // (안 바뀌었으면 서버가 짧게 '그대로'라고만 답해서 데이터는 거의 안 씁니다).
  // 예전에 새로 올려도 Command+Shift+R 을 눌러야 했던 이유가 이것이었어요.
  ev.respondWith(
    fetch(req.url, { cache: "no-cache", credentials: "same-origin" })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
  );
});

/* 앱이 열려 있을 때 새 소식을 기기 알림으로 띄웁니다 (페이지가 부탁하면).
   알림을 누르면 열려 있는 앱 창으로 돌아갑니다. */
self.addEventListener("notificationclick", (ev) => {
  ev.notification.close();
  ev.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      const c = list.find(x => x.url.startsWith(self.registration.scope));
      if (c) { c.postMessage({ type: "open-inbox" }); return c.focus(); }
      return self.clients.openWindow("./#inbox");
    })
  );
});
