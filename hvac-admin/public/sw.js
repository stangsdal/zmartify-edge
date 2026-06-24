const CACHE_NAME = 'hvac-admin-v2';
const RUNTIME_CACHE = 'hvac-admin-runtime-v2';
const CRITICAL_ASSETS = [
  '/',
  '/app/',
  '/app/index.html',
  '/app/manifest.json',
];

// Install event - cache critical assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching critical assets');
      return cache.addAll(CRITICAL_ASSETS).catch((err) => {
        console.warn('[SW] Failed to cache critical assets:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first, fall back to cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  const cacheResponseSafely = (response) => {
    if (!response || !response.ok) {
      return;
    }

    let cloned;
    try {
      cloned = response.clone();
    } catch (err) {
      console.warn('[SW] Skipping cache put, response clone failed:', err);
      return;
    }

    event.waitUntil(
      caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, cloned)).catch((err) => {
        console.warn('[SW] Failed runtime cache put:', err);
      })
    );
  };

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // For API requests, use network-first with cache fallback
  if (url.pathname.startsWith('/app/api') || url.pathname.startsWith('/api')) {
    return event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful API responses
          cacheResponseSafely(response);
          return response;
        })
        .catch(() => {
          // Fall back to cached response if network fails
          return caches.match(request).then((cached) => {
            if (cached) {
              console.log('[SW] Serving from cache:', url.pathname);
              return cached;
            }
            // Return offline indicator
            return new Response(
              JSON.stringify({ error: 'offline', offline: true }),
              {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
              }
            );
          });
        })
    );
  }

  // For assets, use cache-first strategy
  if (
    url.pathname.startsWith('/app/assets') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.svg')
  ) {
    return event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          return cached;
        }
        return fetch(request)
          .then((response) => {
            if (response.ok) {
              cacheResponseSafely(response);
            }
            return response;
          })
          .catch(() => {
            console.log('[SW] Asset not available offline:', url.pathname);
            return new Response('Not available offline', { status: 503 });
          });
      })
    );
  }

  // For HTML pages, use network-first
  if (request.headers.get('accept')?.includes('text/html')) {
    return event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            cacheResponseSafely(response);
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            return (
              cached ||
              new Response(
                '<!DOCTYPE html><html><body>Offline - Page not cached</body></html>',
                { status: 503, headers: { 'Content-Type': 'text/html' } }
              )
            );
          });
        })
    );
  }

  // Default: network first
  return event.respondWith(
    fetch(request)
      .catch(() => {
        return caches
          .match(request)
          .then((cached) => cached || new Response('Network request failed', { status: 503 }));
      })
  );
});

// Message event - handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
