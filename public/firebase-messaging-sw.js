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
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const appClient = clientList.find(c => c.url.includes(self.location.origin));
      if (appClient) {
        // postMessage で FORCE_QUEST_ALL を送る（App.jsx側で受け取りlocalStorageに書く）
        appClient.postMessage({ type: 'FORCE_QUEST_ALL' });
        return appClient.focus();
      }
      // アプリが閉じている → URLパラメータで開く（App.jsx起動時にforceShowNextQuestが呼ばれる）
      return clients.openWindow('/?forceQuest=1');
    })
  );
});
