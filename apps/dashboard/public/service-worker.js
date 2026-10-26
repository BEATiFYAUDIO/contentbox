self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  // Dashboard navigation is deliberately network-only. Core must be running,
  // and a previous Core release must never mask an unavailable or updated one.
  if (request.mode === 'navigate') event.respondWith(fetch(request, { cache: 'no-store' }))
})
