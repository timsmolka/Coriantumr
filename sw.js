/* =========================================================================
   Service worker for the Chernobyl page.

   Purpose: make chernobyl.html and its icons readable with no connection.
   The page pulls in nothing external — no fonts, no scripts, no CDN — so
   caching four files is enough to make the whole thing work offline.

   IMPORTANT — scope. This file sits at the site root, so its scope is the
   whole project site, which means it also controls index.html (Science
   Maps). That app depends on live network access: map tiles, Nominatim
   search, OSRM routing, Open-Meteo weather. So the fetch handler below
   touches ONLY the handful of URLs listed in ASSETS and returns without
   calling respondWith() for everything else, leaving those requests to the
   browser exactly as if no worker were installed.

   Updating: bump CACHE when the page or icons change. The old cache is
   deleted on activation, and stale-while-revalidate means a visit while
   online refreshes the copy for next time.
   ========================================================================= */

const CACHE = 'chernobyl-v1';

const ASSETS = [
  'chernobyl.html',
  'icon-180.png',
  'icon-192.png',
  'favicon-32.png',
];

// Absolute URLs, resolved once, for exact matching in the fetch handler.
const CACHED = new Set(
  ASSETS.map((path) => new URL(path, self.registration.scope).href)
);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  // The icons are requested with a ?v= cache-buster, but they are stored
  // under their bare filename, so compare and look up without the query.
  const url = new URL(request.url);
  url.search = '';
  url.hash = '';
  const key = url.href;

  // Anything we did not explicitly cache — including every request Science
  // Maps makes — is left completely alone.
  if (!CACHED.has(key)) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(key);

      const fromNetwork = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(key, response.clone());
          return response;
        })
        .catch(() => null);

      if (cached) {
        // Serve instantly, refresh in the background for the next visit.
        event.waitUntil(fromNetwork);
        return cached;
      }

      const response = await fromNetwork;
      return (
        response ||
        new Response('Offline and not cached yet.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        })
      );
    })
  );
});
