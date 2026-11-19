const CACHE_PREFIX = `family-dashboard:${self.registration.scope}:`;
const CACHE_VERSION = "v4";
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./assets.js",
  "./media_store.js",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  if (url.pathname.includes("/api/")) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && event.request.method === "GET") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(event.request)) || (await cache.match("./index.html"));
      })
  );
});
