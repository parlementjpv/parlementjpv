// Service worker du Parlement JPV : notifications push et ouverture de l'app.
// Aucune mise en cache des pages : le site reste toujours à jour.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  const base = self.registration.scope;
  e.waitUntil(self.registration.showNotification(d.title || 'Parlement JPV', {
    body: d.body || '',
    icon: base + 'assets/img/icon-192.png',
    badge: base + 'assets/img/favicon-96.png',
    tag: d.tag || undefined,
    data: { url: d.url || base + 'compte/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope + 'compte/';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if ('focus' in w) { await w.navigate(url).catch(() => {}); return w.focus(); } }
    return self.clients.openWindow(url);
  })());
});

// Requis par certains navigateurs pour proposer l'installation ; laisse passer toutes les requêtes telles quelles
self.addEventListener('fetch', () => {});
