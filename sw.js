const CACHE_NAME = 'lsg-attendance-v12';
const ASSETS = [
  './index.html',
  './attendance-app.html',
  './time-report.html',
  './auth-helpers.js',
  './assets/icons/app/icon-192.png',
  './assets/icons/app/icon-512.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(['./index.html','./attendance-app.html','./time-report.html','./auth-helpers.js','./assets/icons/app/icon-192.png','./assets/icons/app/icon-512.png']);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
