// =============================================================================
// Young Lists service worker
// =============================================================================
// Strategy: NETWORK FIRST for every same-origin GET, with the cache as the
// offline fallback.
//
// Why not cache-first (what this app used to do)?
//   Cache-first served index.html, app.js and styles.css out of the cache
//   forever. A deploy only reached a phone when the CACHE_NAME constant happened
//   to change *and* the browser happened to re-fetch sw.js — in practice people
//   had to clear Safari's storage to see a fix. Network-first means a deploy is
//   live on the next load, always, and the app still opens with no signal
//   because the last successful response is in the cache.
//
// The files are a few hundred KB in total, so the extra round-trip is not worth
// optimising away for a household grocery list.
//
// CACHE_VERSION only controls when the *old* cache is dropped; correctness no
// longer depends on remembering to bump it. Bump it anyway on release so stale
// entries do not linger.
// =============================================================================

const CACHE_VERSION = 'v3-2026-08-30';
const CACHE_NAME = `young-lists-${CACHE_VERSION}`;
const NETWORK_TIMEOUT_MS = 4000;

const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './config.js',
  './vendor/supabase-js-2.112.4.umd.js',
  './js/app.js',
  './js/supabase.js',
  './js/ui.js',
  './js/data.js',
  './js/auth.js',
  './js/lists.js',
  './js/stores.js',
  './js/history.js',
  './js/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Individually, so one missing file cannot fail the whole install.
      Promise.all(PRECACHE.map((url) =>
        cache.add(new Request(url, { cache: 'reload' }))
          .catch((error) => console.warn('[sw] could not precache', url, error))
      ))
    )
  );
  // Do NOT skipWaiting here: the page offers the user a reload instead, so code
  // is never swapped underneath someone mid-edit. index.html posts SKIP_WAITING
  // when they accept.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('young-lists-') && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/** Race the network against a timeout so a flaky connection still renders. */
function fetchWithTimeout(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS);
    fetch(request).then(
      (response) => { clearTimeout(timer); resolve(response); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Supabase REST/auth/realtime traffic must never be cached or replayed.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetchWithTimeout(request);
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await cache.match(request);
      if (cached) return cached;
      // A deep link opened offline still gets the shell.
      if (request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return new Response('Offline and this file is not cached.', {
        status: 503, headers: { 'Content-Type': 'text/plain' }
      });
    }
  })());
});
