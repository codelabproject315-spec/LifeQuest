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
  // FirestoreにforceQuestフラグを書き込む（ポーリングが検知してクエスト更新）
  fetch('https://firestore.googleapis.com/v1/projects/lifequest-9271d/databases/(default)/documents/artifacts/lifequest/public/data?updateMask.fieldPaths=forceQuest', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { forceQuest: { booleanValue: true } } }),
  }).catch(() => {});
  return self.registration.showNotification(title || '⚡ 新クエスト到着！', {
    body: body || '5分以内にクリアせよ！',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'lifequest-quest',
    renotify: true,
    requireInteraction: true,
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      const appClient = clientList.find(c => c.url.includes(self.location.origin));
      if (appClient) {
        await appClient.focus();
        appClient.postMessage({ type: 'FORCE_QUEST_ALL' });
        return;
      }
      // アプリが閉じてる → 開いてから起動完了を待ってpostMessage
      const newClient = await clients.openWindow('/');
      setTimeout(() => newClient?.postMessage({ type: 'FORCE_QUEST_ALL' }), 2000);
    })
  );
});
