const CACHE = 'blood-app-v5';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './css/style.css',
  './js/app.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Never cache calls to the Apps Script API — always go to network.
  if (url.includes('script.google.com') || url.includes('script.googleusercontent.com')) {
    event.respondWith(fetch(event.request).catch((err) => new Response(
      JSON.stringify({ ok: false, error: 'network error: ' + (err && err.message ? err.message : String(err)) }),
      { headers: { 'Content-Type': 'application/json' } }
    )));
    return;
  }

  if (event.request.method !== 'GET') return;

  // Network-first for the app shell: always pick up the latest deploy when
  // online, and only fall back to the cache when offline. cache: 'no-store'
  // stops the browser's own HTTP cache from serving a stale GitHub Pages
  // response out from under this logic.
  event.respondWith(
    fetch(event.request, { cache: 'no-store' }).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return res;
    }).catch(() => caches.match(event.request))
  );
});
