const CACHE_NAME = 'nextgen-gold-shell-v2'
const APP_BASE = new URL('./', self.location.href).pathname
const APP_SHELL = [
  APP_BASE,
  `${APP_BASE}admin.html`,
  `${APP_BASE}manifest.webmanifest`,
  `${APP_BASE}nextgen-gold-app.png`,
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name.startsWith('nextgen-gold-shell-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(request) ?? await caches.match(APP_BASE)
        if (!cached) throw new Error('NextGen Gold is not available offline yet.')
        return cached
      }),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (!response.ok || response.type === 'opaque') return response
        const copy = response.clone()
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        return response
      })
    }),
  )
})
