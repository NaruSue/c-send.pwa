importScripts("version.js");

const BASE_PATH = new URL(self.registration.scope).pathname;
const CACHE_NAME = `csend-web-shell-${self.CSEND_WEB_VERSION}`;
const SHELL = [
  "./custom-api.js?v=0.1.87",
  "./easter-egg/cat-game/neko-audio/mugi-hiss.mp3?v=0.1.84",
  "./easter-egg/cat-game/neko-audio/kuro-hiss.mp3?v=0.1.84",
  "./easter-egg/cat-game/neko-audio/koma-hiss.mp3?v=0.1.84",
  "./easter-egg/cat-game/neko-audio/yuki-hiss.mp3?v=0.1.84",
  "./easter-egg/cat-game/neko-audio/boss-hiss.mp3?v=0.1.84",
  "./easter-egg/cat-game/neko-audio/twins-hiss.mp3?v=0.1.84",
  "./",
  "./index.html",
  "./easter-egg/neko-egg.js?v=0.1.84",
  "./easter-egg/cat-game/neko-punch.html?v=0.1.84",
  "./easter-egg/cat-game/neko-audio.js?v=0.1.84",
  "./easter-egg/cat-game/neko-difficulty.js?v=0.1.84",
  "./easter-egg/cat-game/neko-records.js?v=0.1.84",
  "./easter-egg/cat-game/neko-unlocks.js?v=0.1.84",
  "./easter-egg/cat-game/neko-audio/boss-bgm.mp3",
  "./easter-egg/cat-game/neko-audio/twins-bgm.mp3",
  "./easter-egg/cat-game/neko-audio/celebration.mp3",
  "./easter-egg/cat-game/neko-diagnostics.js?v=0.1.84",
  "./easter-egg/cat-game/neko-audio/koma-bgm.mp3",
  "./easter-egg/cat-game/neko-audio/koma-countdown.mp3",
  "./easter-egg/cat-game/neko-audio/koma-ending.mp3",
  "./easter-egg/cat-game/neko-audio/koma-failure.mp3",
  "./easter-egg/cat-game/neko-audio/koma-success.mp3",
  "./easter-egg/cat-game/neko-audio/koma-voice-1.mp3",
  "./easter-egg/cat-game/neko-audio/koma-voice-2.mp3",
  "./easter-egg/cat-game/neko-audio/koma-voice-3.mp3",
  "./easter-egg/cat-game/neko-audio/kuro-bgm.mp3",
  "./easter-egg/cat-game/neko-audio/kuro-countdown.mp3",
  "./easter-egg/cat-game/neko-audio/kuro-ending.mp3",
  "./easter-egg/cat-game/neko-audio/kuro-failure.mp3",
  "./easter-egg/cat-game/neko-audio/kuro-success.mp3",
  "./easter-egg/cat-game/neko-audio/kuro-voice-1.mp3",
  "./easter-egg/cat-game/neko-audio/kuro-voice-2.mp3",
  "./easter-egg/cat-game/neko-audio/kuro-voice-3.mp3",
  "./easter-egg/cat-game/neko-audio/mugi-bgm.mp3",
  "./easter-egg/cat-game/neko-audio/mugi-countdown.mp3",
  "./easter-egg/cat-game/neko-audio/mugi-ending.mp3",
  "./easter-egg/cat-game/neko-audio/mugi-failure.mp3",
  "./easter-egg/cat-game/neko-audio/mugi-success.mp3",
  "./easter-egg/cat-game/neko-audio/mugi-voice-1.mp3",
  "./easter-egg/cat-game/neko-audio/mugi-voice-2.mp3",
  "./easter-egg/cat-game/neko-audio/mugi-voice-3.mp3",
  "./easter-egg/cat-game/neko-audio/yuki-bgm.mp3",
  "./easter-egg/cat-game/neko-audio/yuki-countdown.mp3",
  "./easter-egg/cat-game/neko-audio/yuki-ending.mp3",
  "./easter-egg/cat-game/neko-audio/yuki-failure.mp3",
  "./easter-egg/cat-game/neko-audio/yuki-success.mp3",
  "./easter-egg/cat-game/neko-audio/yuki-voice-1.mp3",
  "./easter-egg/cat-game/neko-audio/yuki-voice-2.mp3",
  "./easter-egg/cat-game/neko-audio/yuki-voice-3.mp3",
  "./manifest.webmanifest?v=0.1.57",
  "./icon.svg?v=0.1.57",
  "./icon-192-v0.1.57.png",
  "./icon-512-v0.1.57.png",
  "./favicon-v0.1.57.png",
  "./favicon-v0.1.57.ico",
  "./apple-touch-icon-v0.1.57.png",
  "./connections.json",
  "./news.json",
  "./version.js"
].map(path => new URL(path, self.registration.scope).href);

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
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE_PATH)) return;
  // Version probes and the worker script must always reach the origin.
  if (url.pathname === BASE_PATH + "version.js" || url.pathname === BASE_PATH + "service-worker.js") return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(async cache => {
        await cache.put(request, response.clone());
        if(url.pathname===BASE_PATH||url.pathname===BASE_PATH+"index.html")await cache.put(BASE_PATH, response.clone());
      });
      return response;
    }).catch(async () => (await caches.match(request)) || ((url.pathname===BASE_PATH||url.pathname===BASE_PATH+"index.html") ? ((await caches.match(BASE_PATH)) || (await caches.match(BASE_PATH+"index.html"))) : Response.error())));
    return;
  }
  event.respondWith(fetch(request).then(response => {
    if (response.ok && response.type === "basic") caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    return response;
  }).catch(async () => (await caches.match(request)) || Response.error()));
});
