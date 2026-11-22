// 앱 화면 파일을 저장해 인터넷 없이도 열리게 합니다. (오디오는 앱이 따로 저장)
const SHELL = "lang3-shell-v9";
const FILES = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "data/lessons.json", "data/tablo.json", "audio/manifest.json", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("lang3-shell") && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 새 버전이 있으면 받아오고, 인터넷이 없으면 저장본 사용
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/audio/items/") || /-(learn|quiz)\.m4a$/.test(url.pathname)) return;
  e.respondWith(
    fetch(e.request.url, { cache: "no-cache" }).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
