// Service worker for the English app PWA.
//
// Strategy, per kind of request:
//   navigation / index.html  -> network-first, fall back to cache (works offline)
//   /assets/* (hashed names) -> cache-first, immutable within a build
//   /dict/*, /grammar/*      -> cache-first, static data (~35MB total, cached on demand)
//   anything else same-origin-> network-first, fall back to cache
//
// Cross-origin requests (CORS proxies, dictionary APIs) are never touched.

// VERSION and PRECACHE are rewritten by scripts/build-sw.mjs after every build,
// so a new build gets a fresh shell cache and ships its hashed assets offline.
const VERSION = 'd99651b205';
const PRECACHE = ["./index.html","./manifest.webmanifest","./favicon.svg","./assets/index-D5C1KInn.js","./assets/index-DKgaVQuk.css","./icons/apple-touch-icon.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png"];

// Shell is per-build. Data is not: dict/grammar files never change, so keeping
// them across deploys avoids re-downloading tens of megabytes.
const SHELL_CACHE = `english-shell-${VERSION}`;
const DATA_CACHE = 'english-data-v1';
const KEEP = [SHELL_CACHE, DATA_CACHE];

// Resolved against the SW scope, so it works at a root or a sub-path deploy.
const INDEX_URL = new URL('./index.html', self.registration.scope).toString();

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        // One at a time: a single missing file must not void the whole precache.
        for (const path of PRECACHE) {
            const url = new URL(path, self.registration.scope).toString();
            try {
                await cache.add(new Request(url, { cache: 'reload' }));
            } catch (e) {
                console.warn('[sw] precache miss:', path);
            }
        }
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter(n => n.startsWith('english-') && !KEEP.includes(n)).map(n => caches.delete(n)));
        await self.clients.claim();
    })());
});

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
}

async function networkFirst(request, cacheName, fallbackUrl) {
    const cache = await caches.open(cacheName);
    try {
        const response = await fetch(request);
        if (response && response.ok) cache.put(request, response.clone());
        return response;
    } catch (e) {
        const hit = await cache.match(request) || (fallbackUrl ? await cache.match(fallbackUrl) : null);
        if (hit) return hit;
        throw e;
    }
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return; // proxies / dictionary APIs

    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request, SHELL_CACHE, INDEX_URL));
        return;
    }

    if (url.pathname.includes('/dict/') || url.pathname.includes('/grammar/')) {
        event.respondWith(cacheFirst(request, DATA_CACHE));
        return;
    }

    event.respondWith(cacheFirst(request, SHELL_CACHE));
});
