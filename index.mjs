// lambda/index.mjs
// AWS Lambda + EventBridge Cron: 10分おきに実行

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = getFirestore();
const messaging = getMessaging();
const APP_ID = process.env.VITE_APP_ID || 'lifequest';

// App.jsxと同じスケジュール生成ロジック
const buildDailySchedule = (seed) => {
  const rng = (n) => {
    let x = Math.sin(seed * 9301 + n * 49297 + 233) * 100000;
    return x - Math.floor(x);
  };
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;
  const QUEST_DURATION = 5 * 60 * 1000;

  return Array.from({ length: 6 }, (_, i) => {
    const slotSize = dayMs / 6;
    const offset = slotSize * i + Math.floor(rng(i * 7 + 1) * slotSize);
    const deliverAt = todayStart.getTime() + offset;
    return { index: i, deliverAt, deadlineTs: deliverAt + QUEST_DURATION };
  });
};

export const handler = async () => {
  const now = Date.now();
  const seed = Math.floor(now / 86400000);
  const schedule = buildDailySchedule(seed);
  const WINDOW = 10 * 60 * 1000; // 10分ウィンドウ

  // 今から10分以内に配信されるクエストを特定
  const dueTasks = schedule.filter(
    (q) => q.deliverAt >= now && q.deliverAt < now + WINDOW
  );

  if (dueTasks.length === 0) {
    console.log('No quests due in this window');
    return { statusCode: 200, body: 'No quests due' };
  }

  // FCMトークンを持つユーザーを全取得
  const snapshot = await db
    .collection('artifacts')
    .doc(APP_ID)
    .collection('public')
    .doc('data')
    .collection('users')
    .where('fcmToken', '!=', null)
    .get();

  if (snapshot.empty) {
    console.log('No users with FCM tokens');
    return { statusCode: 200, body: 'No users' };
  }

  const tokens = snapshot.docs.map((d) => d.data().fcmToken).filter(Boolean);

  // 通知送信
  const results = await Promise.allSettled(
    tokens.map((token) =>
      messaging.send({
        token,
        notification: {
          title: '⚡ クエスト到着！',
          body: '新しいクエストが届いた！5分以内にクリアせよ！',
        },
        webpush: {
          notification: {
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: 'lifequest-quest',
            renotify: true,
            requireInteraction: true,
          },
          fcmOptions: { link: '/' },
        },
      })
    )
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;
  console.log(`Sent: ${succeeded}, Failed: ${failed}`);

  return { statusCode: 200, body: JSON.stringify({ sent: succeeded, failed }) };
};
