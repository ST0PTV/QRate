// Offline-Cache für die App-Hülle. Daten von Supabase (anderer Ursprung) gehen nie durch den Cache.
// Neue Datei → hier eintragen und CACHE_VERSION erhöhen (npm run check prüft das).
const CACHE_VERSION = 'qr-0.1.0-2';
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/core/api.js',
  'js/core/code.js',
  'js/core/config.js',
  'js/core/errors.js',
  'js/core/parse.js',
  'js/core/scanner.js',
  'js/core/store.js',
  'js/core/ui.js',
  'js/features/auth.js',
  'js/features/box.js',
  'js/features/home.js',
  'js/features/household.js',
  'js/features/labels.js',
  'js/features/scan.js',
  'js/features/search.js',
  'vendor/qrcode.js',
  'vendor/supabase.js',
  'vendor/zxing.min.js',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('qr-') && k !== CACHE_VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Seitenaufrufe (auch mit ?k=…): erst Netz, dann Cache – so kommen Updates sofort an
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
