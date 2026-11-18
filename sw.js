/* 목자의 삶 — 서비스 워커
   - 앱 화면(html/js/아이콘)만 캐시해서 오프라인에서도 열리게 함
   - Firebase 통신은 절대 캐시하지 않음 (항상 최신 데이터)
   - 파일을 새로 올리면 CACHE 이름을 바꿔 새 버전을 받게 함 */

const CACHE = "mokja-v48-2";
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/icon-maskable-512.png",
  "./icons/favicon-32.png",
  "./icons/favicon-48.png",
  "./fonts/Cafe24SsukssukRegular.woff2",
  "./fonts/Cafe24SsukssukLight.woff2",
  "./img/home-dark.webp",
  "./img/home-light.webp",
  "./img/done-report.webp"
];
/* 36단계 — 글꼴은 바뀌지 않으니 한 번 받으면 기기에 둔 것을 바로 씁니다 (1MB 넘는 파일을 매번 묻지 않게) */
const FONT_CACHE = "mokja-fonts-1";

self.addEventListener("install", (ev) => {
  self.skipWaiting();
  ev.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {}))
  );
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== FONT_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // 우리 사이트 파일이 아니면 건드리지 않음 (Firebase, 구글 폰트 등)
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes("/fonts/")) {
    ev.respondWith(caches.open(FONT_CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) c.put(req, res.clone()).catch(() => {});
      return res;
    }))));
    return;
  }

  if (url.pathname.endsWith("/version.json")) return;   // 새 버전 확인은 늘 서버에서

  // 46단계 — 저장본 먼저(빠르게 열기), 그와 동시에 서버에 '바뀌었나' 물어 저장본을 새것으로 바꿔 둡니다.
  // 새로 올린 파일은 앱 위 '새 버전 → 지금 새로고침'을 누르면 바로, 안 눌러도 다음에 열 때 들어와요.
  ev.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req);
    const net = fetch(req.url, { cache: "no-cache", credentials: "same-origin" }).then(res => {
      if (res.ok) c.put(req, res.clone()).catch(() => {});
      return res;
    });
    if (hit) { ev.waitUntil(net.catch(() => {})); return hit; }
    return net.catch(() => c.match("./index.html"));
  }));
});

/* 48단계 — 앱이 닫혀 있어도 오는 알림 (서버 함수가 보낸 것)
   잠금 화면 글은 서버가 정해요 — 받는 사람이 '내용 보이기'를 켜지 않았으면 내용 없이. */
self.addEventListener("push", (ev) => {
  let p = {}; try { p = ev.data ? ev.data.json() : {}; } catch { p = {}; }
  const d = p.data || p.notification || p || {};
  const url = typeof d.url === "string" && d.url.startsWith("./") ? d.url : "./";
  ev.waitUntil(self.registration.showNotification(d.title || "목자의 삶", {
    body: d.body || "", tag: d.tag || "mokja", icon: "./icons/icon-192.png", badge: "./icons/favicon-48.png", data: { url }
  }));
});

/* 앱이 열려 있을 때 새 소식을 기기 알림으로 띄웁니다 (페이지가 부탁하면).
   알림을 누르면 열려 있는 앱 창으로 돌아갑니다. */
self.addEventListener("notificationclick", (ev) => {
  ev.notification.close();
  ev.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      const url = (ev.notification.data && ev.notification.data.url) || "./#inbox";
      const c = list.find(x => x.url.startsWith(self.registration.scope));
      if (c) { c.postMessage({ type: url.includes("#post-") ? "open-post" : url === "./" ? "open-home" : "open-inbox", id: url.split("#post-")[1] || "" }); return c.focus(); }
      return self.clients.openWindow(url);
    })
  );
});
