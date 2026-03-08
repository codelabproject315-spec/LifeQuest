importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyCCPmI5_e_xkfK0d5DXo735SIOCzwa60_I",
  authDomain:        "lifequest-9271d.firebaseapp.com",
  projectId:         "lifequest-9271d",
  storageBucket:     "lifequest-9271d.firebasestorage.app",
  messagingSenderId: "181433868032",
  appId:             "1:181433868032:web:ba16c9d0fe112648fe9de5",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  const isForce = payload.data?.force === 'true';
  return self.registration.showNotification(title || '⚡ 新クエスト到着！', {
    body: body || '5分以内にクリアせよ！',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'lifequest-quest',
    renotify: true,
    requireInteraction: true,
    data: { force: isForce },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // 常にURLパラメータ経由で開き直す（postMessageは確実性が低いため）
  event.waitUntil(
    clients.openWindow('/?forceQuest=1')
  );
});
