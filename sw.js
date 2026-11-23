// Offline-Cache für die App-Hülle. Daten von Supabase (anderer Ursprung) gehen nie durch den Cache.
// Neue Datei → hier eintragen und CACHE_VERSION erhöhen (npm run check prüft das).
const CACHE_VERSION = 'qr-0.2.0-11';
// Inhalt: 780d90956210eed6
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
  'js/core/photo.js',
  'js/core/types.js',
  'js/core/ics.js',
  'js/core/scanner.js',
  'js/core/store.js',
  'js/core/ui.js',
  'js/core/warranty.js',
  'js/core/zip.js',
  'js/core/backup.js',
  'js/features/auth.js',
  'js/features/box.js',
  'js/features/home.js',
  'js/features/household.js',
  'js/features/labels.js',
  'js/features/purchase.js',
  'js/features/check-round.js',
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

// Nur im eigenen Cache suchen: andere Apps auf derselben Adresse (st0ptv.github.io) haben eigene Caches
const own = req => caches.open(CACHE_VERSION).then(c => c.match(req));

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Seitenaufrufe (auch mit ?k=…): erst Netz, dann Cache – so kommen Updates sofort an
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => own('index.html')));
    return;
  }
  e.respondWith(own(req).then(hit => hit || fetch(req)));
});
