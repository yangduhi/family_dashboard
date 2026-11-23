const CACHE_PREFIX = `family-dashboard:${self.registration.scope}:`;
const CACHE_VERSION = "v16";
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const SHELL_ASSETS = [
  "./",
  "./styles.css",
  "./assets.js",
  "./media_store.js",
  "./app.js",
  "./stamp-audio.js",
  "./audio/stamp.wav",
  "./audio/paper.wav",
  "./audio/ready.wav",
  "./supplies.js",
  "./kidsnote_app_icon.svg",
  "./fonts/PretendardVariable.woff2",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];
const ROOT_URL = self.registration.scope;
const INDEX_URL = new URL("./index.html", ROOT_URL).href;
const versionedAsset = (url) => /\.(css|js|svg|wav|woff2)$/.test(url.pathname);
const SHELL_URLS = new Set(SHELL_ASSETS.map((path) => {
  const url = new URL(path, ROOT_URL);
  if (versionedAsset(url)) url.searchParams.set("release", CACHE_VERSION);
  return url.href;
}));
const VERSION_MARKER = `<meta name="family-dashboard-release" content="${CACHE_VERSION}">`;

async function isStaticResponse(url, response) {
  if (!response.ok || response.redirected || response.url !== url ||
      /\bno-store\b/i.test(response.headers.get("cache-control") ?? "")) return false;
  const type = (response.headers.get("content-type") ?? "").split(";", 1)[0];
  const pathname = new URL(url).pathname;
  if (pathname.endsWith(".js")) return ["text/javascript", "application/javascript"].includes(type);
  if (pathname.endsWith(".css")) return type === "text/css";
  if (pathname.endsWith(".wav")) return ["audio/wav", "audio/x-wav", "audio/wave"].includes(type);
  if (pathname.endsWith(".woff2")) return type === "font/woff2";
  if (pathname.endsWith(".svg")) return type === "image/svg+xml";
  if (pathname.endsWith(".png")) return type === "image/png";
  if (pathname.endsWith(".json")) return ["application/json", "application/manifest+json"].includes(type);
  return type === "text/html" && (await response.clone().text()).includes(VERSION_MARKER);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const assets = await Promise.all([...SHELL_URLS].map(async (url) => {
        const response = await fetch(url, { cache: "reload", redirect: "error" });
        if (!await isStaticResponse(url, response)) throw new Error("Invalid shell asset");
        return [url, response];
      }));
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(assets.map(([url, response]) => cache.put(url, response)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const older = (await caches.keys()).filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
    // A still-open document can finish reading assets from its previous release.
    await Promise.all(older.slice(0, -1).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "family-dashboard-release") event.ports[0]?.postMessage(CACHE_VERSION);
});

async function navigate(request) {
  const installed = () => caches.match(ROOT_URL, { cacheName: CACHE_NAME });
  try {
    const online = await fetch(request, { cache: "no-store" });
    if (!online.ok || online.redirected || online.url !== request.url) return online;
    const html = await online.clone().text();
    if (!html.includes('<meta name="family-dashboard-shell" content="2">')) return online;
    return (await installed()) ?? online;
  } catch {
    return (await installed()) ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { method, url } = event.request;
  if (method !== "GET") return;
  if (url === ROOT_URL || url === INDEX_URL) {
    event.respondWith(navigate(event.request));
    return;
  }
  if (SHELL_URLS.has(url)) {
    event.respondWith(caches.match(url, { cacheName: CACHE_NAME })
      .then((response) => response ?? fetch(event.request)));
    return;
  }
  const asset = new URL(url);
  const previous = asset.searchParams.get("release");
  if (!/^[a-z0-9-]{1,40}$/.test(previous ?? "") || previous === CACHE_VERSION || !versionedAsset(asset)) return;
  asset.search = "";
  asset.searchParams.set("release", CACHE_VERSION);
  if (!SHELL_URLS.has(asset.href)) return;
  event.respondWith(caches.match(url, { cacheName: CACHE_PREFIX + previous })
    .then((response) => response ?? fetch(event.request, { cache: "no-store" })));
});
