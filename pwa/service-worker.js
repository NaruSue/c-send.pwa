importScripts("version.js");

const CACHE_NAME = `csend-web-shell-${self.CSEND_WEB_VERSION}`;
const SHELL = [
  "/c-send/pwa/neko-audio/mugi-hiss.mp3?v=0.1.84",
  "/c-send/pwa/neko-audio/kuro-hiss.mp3?v=0.1.84",
  "/c-send/pwa/neko-audio/koma-hiss.mp3?v=0.1.84",
  "/c-send/pwa/neko-audio/yuki-hiss.mp3?v=0.1.84",
  "/c-send/pwa/neko-audio/boss-hiss.mp3?v=0.1.84",
  "/c-send/pwa/neko-audio/twins-hiss.mp3?v=0.1.84",
  "/c-send/pwa/",
  "/c-send/pwa/index.html",
  "/c-send/pwa/neko-egg.js?v=0.1.84",
  "/c-send/pwa/neko-punch.html?v=0.1.84",
  "/c-send/pwa/neko-audio.js?v=0.1.84",
  "/c-send/pwa/neko-difficulty.js?v=0.1.84",
  "/c-send/pwa/neko-records.js?v=0.1.84",
  "/c-send/pwa/neko-unlocks.js?v=0.1.84",
  "/c-send/pwa/neko-audio/boss-bgm.mp3",
  "/c-send/pwa/neko-audio/twins-bgm.mp3",
  "/c-send/pwa/neko-audio/celebration.mp3",
  "/c-send/pwa/neko-diagnostics.js?v=0.1.84",
  "/c-send/pwa/neko-audio/koma-bgm.mp3",
  "/c-send/pwa/neko-audio/koma-countdown.mp3",
  "/c-send/pwa/neko-audio/koma-ending.mp3",
  "/c-send/pwa/neko-audio/koma-failure.mp3",
  "/c-send/pwa/neko-audio/koma-success.mp3",
  "/c-send/pwa/neko-audio/koma-voice-1.mp3",
  "/c-send/pwa/neko-audio/koma-voice-2.mp3",
  "/c-send/pwa/neko-audio/koma-voice-3.mp3",
  "/c-send/pwa/neko-audio/kuro-bgm.mp3",
  "/c-send/pwa/neko-audio/kuro-countdown.mp3",
  "/c-send/pwa/neko-audio/kuro-ending.mp3",
  "/c-send/pwa/neko-audio/kuro-failure.mp3",
  "/c-send/pwa/neko-audio/kuro-success.mp3",
  "/c-send/pwa/neko-audio/kuro-voice-1.mp3",
  "/c-send/pwa/neko-audio/kuro-voice-2.mp3",
  "/c-send/pwa/neko-audio/kuro-voice-3.mp3",
  "/c-send/pwa/neko-audio/mugi-bgm.mp3",
  "/c-send/pwa/neko-audio/mugi-countdown.mp3",
  "/c-send/pwa/neko-audio/mugi-ending.mp3",
  "/c-send/pwa/neko-audio/mugi-failure.mp3",
  "/c-send/pwa/neko-audio/mugi-success.mp3",
  "/c-send/pwa/neko-audio/mugi-voice-1.mp3",
  "/c-send/pwa/neko-audio/mugi-voice-2.mp3",
  "/c-send/pwa/neko-audio/mugi-voice-3.mp3",
  "/c-send/pwa/neko-audio/yuki-bgm.mp3",
  "/c-send/pwa/neko-audio/yuki-countdown.mp3",
  "/c-send/pwa/neko-audio/yuki-ending.mp3",
  "/c-send/pwa/neko-audio/yuki-failure.mp3",
  "/c-send/pwa/neko-audio/yuki-success.mp3",
  "/c-send/pwa/neko-audio/yuki-voice-1.mp3",
  "/c-send/pwa/neko-audio/yuki-voice-2.mp3",
  "/c-send/pwa/neko-audio/yuki-voice-3.mp3",
  "/c-send/pwa/manifest.webmanifest?v=0.1.57",
  "/c-send/pwa/icon.svg?v=0.1.57",
  "/c-send/pwa/icon-192-v0.1.57.png",
  "/c-send/pwa/icon-512-v0.1.57.png",
  "/c-send/pwa/favicon-v0.1.57.png",
  "/c-send/pwa/favicon-v0.1.57.ico",
  "/c-send/pwa/apple-touch-icon-v0.1.57.png",
  "/c-send/pwa/connections.json",
  "/c-send/pwa/news.json",
  "/c-send/pwa/version.js"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("csend-web-shell-") && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/c-send/pwa/")) return;
  // Version probes and the worker script must always reach the origin.
  if (url.pathname === "/c-send/pwa/version.js" || url.pathname === "/c-send/pwa/service-worker.js") return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(async cache => {
        await cache.put(request, response.clone());
        if(url.pathname==="/c-send/pwa/"||url.pathname==="/c-send/pwa/index.html")await cache.put("/c-send/pwa/", response.clone());
      });
      return response;
    }).catch(async () => (await caches.match(request)) || ((url.pathname==="/c-send/pwa/"||url.pathname==="/c-send/pwa/index.html") ? ((await caches.match("/c-send/pwa/")) || (await caches.match("/c-send/pwa/index.html"))) : Response.error())));
    return;
  }
  event.respondWith(fetch(request).then(response => {
    if (response.ok && response.type === "basic") caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    return response;
  }).catch(async () => (await caches.match(request)) || Response.error()));
});
