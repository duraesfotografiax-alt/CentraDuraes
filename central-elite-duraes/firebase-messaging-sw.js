// Service worker: recebe as notificações com o app fechado e abre a Central ao tocar.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
importScripts('firebase-config.js');

firebase.initializeApp(self.FIREBASE_CONFIG);
const messaging = firebase.messaging();

// Mensagens só com dados (sem "notification") viram notificação aqui.
messaging.onBackgroundMessage((m) => {
  if (m.notification) return; // o Firebase já mostra sozinho
  const d = m.data || {};
  self.registration.showNotification(d.title || 'Central', { body: d.body || '', icon: 'icons/icon-192.png', data: { link: d.link } });
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = (e.notification.data && (e.notification.data.link || (e.notification.data.FCM_MSG && e.notification.data.FCM_MSG.fcmOptions && e.notification.data.FCM_MSG.fcmOptions.link))) || self.registration.scope;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus(); }
    return clients.openWindow(link);
  }));
});
