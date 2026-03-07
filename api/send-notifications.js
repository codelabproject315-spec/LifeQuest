// api/send-notifications.js
// Vercel Cron Job: 10分ごとに実行、クエスト配信時刻になったユーザーに通知を送る

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

// Firebase Admin 初期化（環境変数から）
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:    process.env.FIREBASE_PROJECT_ID,
      clientEmail:  process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:   process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = getFirestore();
const messaging = getMessaging();
const APP_ID = process.env.VITE_APP_ID || 'lifequest-default';

// クエストスケジュール生成（App.jsxと同じロジック）
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

export default async function handler(req, res) {
  // Vercel Cronからのリクエストのみ許可
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = Date.now();
  const seed = Math.floor(now / 86400000);
  const schedule = buildDailySchedule(seed);
  const WINDOW = 10 * 60 * 1000; // 10分ウィンドウ（Cronが10分おきに実行）

  // 今から10分以内に配信されるクエストを特定
  const dueTasks = schedule.filter(
    (q) => q.deliverAt >= now && q.deliverAt < now + WINDOW
  );

  if (dueTasks.length === 0) {
    return res.status(200).json({ message: 'No quests due', checked: schedule.length });
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
    return res.status(200).json({ message: 'No users with FCM tokens' });
  }

  const tokens = snapshot.docs
    .map((d) => d.data().fcmToken)
    .filter(Boolean);

  // 通知送信
  const messages = tokens.map((token) => ({
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
  }));

  const results = await Promise.allSettled(
    messages.map((msg) => messaging.send(msg))
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  return res.status(200).json({ sent: succeeded, failed, questsTriggered: dueTasks.length });
}
