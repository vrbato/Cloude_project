/* Service worker: aplikace se načte okamžitě i offline, data se berou ze sítě
   a při výpadku z poslední uložené odpovědi. */
const VERSION = "valuace-v2";
const SHELL = [
  "/",
  "/css/app.css",
  "/js/app.js",
  "/js/charts.js",
  "/js/format.js",
  "/js/metrics.js",
  "/js/valuation.js",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== VERSION + "-api").map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // API: nejdřív síť, při chybě poslední uložená odpověď
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && url.pathname.startsWith("/api/stock/")) {
            const copy = res.clone();
            caches.open(VERSION + "-api").then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(() => caches.match(url.pathname).then((r) => r || Response.error())),
    );
    return;
  }

  // Aplikace: okamžitě z cache, na pozadí aktualizace (stale-while-revalidate)
  const key = req.mode === "navigate" ? "/" : req;
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(key);
      const network = fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
