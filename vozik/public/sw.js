/* Service worker: aplikace se otevře okamžitě a funguje i bez internetu.
   Soubory se berou z cache a na pozadí se aktualizují (stale-while-revalidate).
   Při větší změně zvyšte VERSION. */
const VERSION = "vozik-v2";
const SHELL = [
  "/",
  "/css/app.css",
  "/js/app.js",
  "/js/game.js",
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
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const key = req.mode === "navigate" ? "/" : req;
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(key, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached || Response.error());
      if (cached) {
        event.waitUntil(network.catch(() => {}));
        return cached;
      }
      return network;
    }),
  );
});
