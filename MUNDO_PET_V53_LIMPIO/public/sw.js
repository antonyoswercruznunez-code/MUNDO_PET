/*
 * Service worker de Mundo Pet: permite instalar el panel y la tienda como
 * app. No guarda datos ni respuestas de la API: todo se pide al servidor
 * como siempre. Solo muestra una pantalla amable si no hay conexión.
 */
const CACHE = 'mundo-pet-app-v1';
const OFFLINE = '/offline.html';
const SHELL = [OFFLINE, '/assets/img/app/icon-192.png', '/assets/img/app/favicon-48.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Solo las páginas (navegación) tienen respaldo sin conexión.
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  event.respondWith(fetch(request).catch(() => caches.match(OFFLINE)));
});
