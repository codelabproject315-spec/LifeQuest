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

const showQuestNotification = (title, body, isForce) => {
  self.registration.showNotification(title || '⚡ 新クエスト到着！', {
    body: body || '5分以内にクリアせよ！',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'lifequest-quest',
    renotify: true,
    requireInteraction: true,
    data: { force: isForce },
  });
};

// バックグラウンド時
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  const isForce = payload.data?.force === 'true';
  showQuestNotification(title, body, isForce);
});

// フォアグラウンド時（アプリが開いている状態でも通知バナーを出す）
self.addEventListener('push', (event) => {
  let title = '⚡ 新クエスト到着！';
  let body = '5分以内にクリアせよ！';
  let isForce = false;
  try {
    const data = event.data?.json();
    title = data?.notification?.title || title;
    body = data?.notification?.body || body;
    isForce = data?.data?.force === 'true';
  } catch {}
  event.waitUntil(showQuestNotification(title, body, isForce));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const isForceAll = event.notification.data?.force === true;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          // 管理者通知なら全クエスト表示、通常なら1個
          client.postMessage({ type: isForceAll ? 'FORCE_QUEST_ALL' : 'FORCE_QUEST' });
          return client.focus();
        }
      }
      // アプリが閉じている場合はURLパラメータで区別
      return clients.openWindow(isForceAll ? '/?forceQuestAll=1' : '/?forceQuest=1');
    })
  );
});
