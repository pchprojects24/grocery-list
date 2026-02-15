const CACHE_NAME = 'young-lists-v2';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.json'
];

// Install Event: Cache assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Caching shell assets');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    // Force waiting service worker to become active immediately
    self.skipWaiting();
});

// Activate Event: Cleanup old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(
                keyList.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('[SW] Removing old cache', key);
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    // Claim clients to control them immediately
    return self.clients.claim();
});

// Fetch Event: Stale-while-revalidate for app shell, Network-first (or Firebase SDKs) handled by browser default for now usually.
// For this MVP, we use a simple Cache-First strategy for the shell assets to ensure offline load,
// but since we are dependent on Firebase for data, offline data access requires Firestore persistence enabled in app.js
self.addEventListener('fetch', (event) => {
    // Only cache same-origin requests to avoid caching dynamic Firebase API calls indiscriminately here
    // (Firestore SDK has its own internal persistence mechanism)
    if (event.request.url.startsWith(self.location.origin)) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                // Return cached response if available
                if (cachedResponse) {
                    return cachedResponse;
                }
                // Otherwise fetch from network
                return fetch(event.request);
            })
        );
    }
});

// Listen for message to update
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
