const CACHE_NAME = 'visionassist-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch((err) => {
        console.warn('PWA Asset pre-caching warning:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Bypass Service Worker completely for API routes and non-GET requests
  if (url.pathname.startsWith('/api/') || event.request.method !== 'GET') {
    return;
  }

  // 2. Navigation fallback for single-page routing (e.g. /doc-reader, /place-finder)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached = (await caches.match('/index.html')) || (await caches.match('/'));
        if (cached) {
          return cached;
        }
        return new Response(
          '<!DOCTYPE html><html><head><title>VisionAssist</title></head><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;padding:2rem;text-align:center;"><h1>VisionAssist</h1><p>You appear to be offline. Reconnect to use online features.</p></body></html>',
          {
            headers: { 'Content-Type': 'text/html' }
          }
        );
      })
    );
    return;
  }

  // 3. Static asset caching with safe rejection handling
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).catch(() => {
        return new Response('', { status: 408, statusText: 'Resource request timed out' });
      });
    })
  );
});
