const TILE_CACHE_NAME = 'ham-altamura-osm-tiles-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  if (!url.includes('tile.openstreetmap.org/')) return;

  event.respondWith(
    caches.open(TILE_CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;

      try {
        const response = await fetch(event.request);
        if (response.ok) {
          cache.put(event.request, response.clone());
        }
        return response;
      } catch (err) {
        if (cached) return cached;
        throw err;
      }
    })
  );
});
