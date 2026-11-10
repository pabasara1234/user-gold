const CACHE_NAME = 'nextgen-gold-shell-v3'
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

self.addEventListener('push', (event) => {
  let payload = {}
  const text = event.data?.text() ?? ''
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { body: text }
    }
  }
  const title = typeof payload.title === 'string' ? payload.title : 'NextGen Gold signal'
  const options = {
    body: typeof payload.body === 'string' ? payload.body : 'A new market signal is available.',
    icon: `${APP_BASE}nextgen-gold-app.png`,
    badge: `${APP_BASE}nextgen-gold-app.png`,
    tag: typeof payload.tag === 'string' ? payload.tag : 'nextgen-gold-signal',
    data: { url: APP_BASE },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => new URL(client.url).origin === self.location.origin)
      if (existing) {
        const target = new URL(APP_BASE, self.location.origin).href
        const navigation = existing.url === target ? Promise.resolve(existing) : existing.navigate(target)
        return navigation.then((client) => client?.focus())
      }
      return self.clients.openWindow(APP_BASE)
    }),
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
