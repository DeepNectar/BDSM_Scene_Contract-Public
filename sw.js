/* ============================================================
   Deep & Honey · Eternal Contract — service worker (v4.13b)
   • App-shell caching for offline/PWA use
   • Receives DH_STATE messages from js/app.js and keeps the
     latest user data mirrored in IndexedDB so an offline
     reload still restores everything on every device.
   NOTE: this file was previously missing from the deploy, which
   made navigator.serviceWorker.register('sw.js') fail with 404.
   ============================================================ */
'use strict';

const CACHE_NAME = 'dh-contract-v49';
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css?v=48',
  './js/supabase-config.js',
  './js/cloud.js?v=43',
  './js/logbook.js?v=16',
  './js/app.js?v=50',
  './manifest.webmanifest',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Never intercept Supabase / API / cross-origin CDN traffic — network only.
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first so devices always get the freshest HTML,
  // falling back to cache when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets: stale-while-revalidate (instant offline, fresh in background).
  e.respondWith(
    caches.match(req).then(cached => {
      const refresh = fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || refresh;
    })
  );
});

/* ---------- user-data mirror (IndexedDB, survives offline reloads) ---------- */
const DB_NAME = 'dh-contract-sw';
const STORE = 'state';

function openDb() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => { rq.result.createObjectStore(STORE); };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}

self.addEventListener('message', e => {
  const msg = e.data || {};
  if (msg.type === 'DH_STATE' && typeof msg.key === 'string') {
    e.waitUntil(
      openDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(msg.value, msg.key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      })).catch(() => { /* storage unavailable — ignore */ })
    );
  }
  if (msg.type === 'DH_SKIP_WAITING') self.skipWaiting();
});
