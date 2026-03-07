// public/firebase-messaging-sw.js
// Firebase Cloud Messaging Service Worker

importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

// ここの値はVercelの環境変数と同じものを設定
firebase.initializeApp({
  apiKey:            self.VITE_FIREBASE_API_KEY,
  authDomain:        self.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         self.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     self.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: self.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             self.VITE_FIREBASE_APP_ID,
});

const messaging = firebase.messaging();

// バックグラウンドでの通知受信
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Background message:', payload);
  const { title, body, icon } = payload.notification || {};
  self.registration.showNotification(title || '⚡ 新クエスト到着！', {
    body: body || 'タップして確認！5分以内にクリアせよ！',
    icon: icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'lifequest-quest',
    renotify: true,
    data: payload.data,
  });
});

// 通知タップ → アプリを開く
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('/');
    })
  );
});
