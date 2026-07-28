"use strict";
/* Bump la versione a ogni rilascio: forza la pulizia delle cache vecchie. */
const CACHE = "rta-eq-v6";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./favicon-32.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      /* cache:"reload" = ignora la cache HTTP del browser, altrimenti il precache
         può salvare una versione vecchia servita da GitHub Pages (max-age). */
      .then(c => c.addAll(ASSETS.map(u => new Request(u, {cache: "reload"}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/*
  Strategia differenziata:
  - documento HTML (navigazione): PRIMA la rete, cache solo come fallback offline.
    Senza questo, una versione vecchia dell'app resta in cache per sempre e gli
    aggiornamenti non arrivano mai all'utente.
  - resto (icone, manifest): cache-first con aggiornamento in background.
*/
function isHtml(req){
  return req.mode === "navigate" ||
         (req.headers.get("accept") || "").includes("text/html");
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  if (isHtml(req)) {
    e.respondWith(
      /* no-store: senza questo la fetch può restituire l'HTML dalla cache HTTP
         del browser e l'aggiornamento non arriva comunque all'utente. */
      fetch(req, {cache: "no-store"})
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then(c => c || caches.match("./index.html")))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(cached => {
      const fetchPromise = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
