// Offline support and fast repeat loads.
// - The page itself: network first, so a new version shows up right away, but if the network is slow
//   (over 2.5 seconds) the cached copy is shown instead and the new one is saved for next time.
// - Word list, icons, manifest: served from cache at once, refreshed in the background.
// - The font never changes: cache first.
// Bump CACHE when the precache list changes. Old caches are deleted on activate.
const CACHE = "bw-v16";
const PRECACHE = ["./", "manifest.webmanifest", "icon-192.png", "icon-512.png", "words.json", "levels.json", "fonts/fredoka-latin.woff2", "fonts/titan-one-latin.woff2"];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).catch(() => {}));
});
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

const save = (req, res) => { if (res && res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); } return res; };

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    // The app is one page; any navigation (including ?room= invite links) uses the cached copy of "./".
    const net = fetch(req).then(r => save(new Request("./"), r));
    e.respondWith(new Promise(resolve => {
      let done = false;
      const fallback = () => caches.match("./").then(r => { if (r && !done) { done = true; resolve(r); } });
      const t = setTimeout(fallback, 2500);
      net.then(r => { clearTimeout(t); if (!done) { done = true; resolve(r); } })
         .catch(() => { clearTimeout(t); caches.match("./").then(r => { if (!done) { done = true; resolve(r || Response.error()); } }); });
    }));
    e.waitUntil(net.catch(() => {}));
    return;
  }

  if (url.pathname.startsWith("/fonts/")) {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => save(req, res))));
    return;
  }

  // Stale-while-revalidate for everything else.
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(res => save(req, res));
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  }));
});
