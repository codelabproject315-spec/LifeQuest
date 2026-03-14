const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

const db = getFirestore();
const APP_ID = 'lifequest';

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

const sendQuestNotifications = async () => {
  const now = Date.now();
  const seed = Math.floor(now / 86400000);
  const schedule = buildDailySchedule(seed);

  // 直近10分以内に deliverAt があるクエストを対象に
  // ただし「送信済み」フラグをFirestoreで管理して重複送信を防ぐ
  const WINDOW = 10 * 60 * 1000;
  const dueTasks = schedule.filter(
    (q) => q.deliverAt >= now - WINDOW && q.deliverAt < now
  );

  if (dueTasks.length === 0) {
    console.log('No quests due');
    return { sent: 0, failed: 0 };
  }

  // 送信済みチェック
  const sentRef = db
    .collection('artifacts')
    .doc(APP_ID)
    .collection('public')
    .doc('data')
    .collection('sentNotifications');

  const results = [];
  for (const task of dueTasks) {
    const docId = `${seed}-${task.index}`;
    const sentDoc = await sentRef.doc(docId).get();
    if (sentDoc.exists) {
      console.log(`Quest ${task.index} already sent, skipping`);
      continue;
    }

    // 送信済みフラグを立てる
    await sentRef.doc(docId).set({ sentAt: Date.now(), index: task.index });

    // ユーザーに送信
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
      continue;
    }

    const messaging = getMessaging();
    const seen = new Set();
    const tokens = snapshot.docs
      .map(d => d.data().fcmToken)
      .filter(t => { if (!t || seen.has(t)) return false; seen.add(t); return true; });

    const sendResults = await Promise.allSettled(
      tokens.map((token) => messaging.send({
        token,
        notification: {
          title: '⚡ クエスト到着！',
          body: `新しいクエストが届いた！5分以内にクリアせよ！`,
        },
        webpush: {
          notification: {
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: `lifequest-quest-${task.index}`,
            renotify: true,
            requireInteraction: true,
          },
          fcmOptions: { link: '/' },
        },
      }))
    );

    const sent = sendResults.filter(r => r.status === 'fulfilled').length;
    const failed = sendResults.filter(r => r.status === 'rejected').length;
    console.log(`Quest ${task.index} 送信完了: ${sent}件成功, ${failed}件失敗`);
    results.push({ index: task.index, sent, failed });
  }

  return results;
};

// 10分ごとに自動実行
exports.scheduleQuestNotifications = onSchedule('every 10 minutes', async () => {
  await sendQuestNotifications();
});

// 管理者タブからの手動送信
exports.sendNotificationsHttp = onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  try {
    const { title, body } = req.body || {};
    const snapshot = await db
      .collection('artifacts')
      .doc(APP_ID)
      .collection('public')
      .doc('data')
      .collection('users')
      .where('fcmToken', '!=', null)
      .get();

    if (snapshot.empty) return res.status(200).json({ sent: 0, failed: 0, results: [] });

    const messaging = getMessaging();
    const seen = new Set();
    const userTokens = snapshot.docs
      .map(d => ({ userId: d.id, ...d.data() }))
      .filter(u => {
        if (!u.fcmToken || seen.has(u.fcmToken)) return false;
        seen.add(u.fcmToken);
        return true;
      });

    const details = await Promise.all(
      userTokens.map(u =>
        messaging.send({
          token: u.fcmToken,
          notification: {
            title: title || '⚡ クエスト到着！',
            body: body || '新しいクエストが届いた！5分以内にクリアせよ！',
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
        .then(() => ({ userId: u.userId, token: u.fcmToken, success: true }))
        .catch(e => ({ userId: u.userId, token: u.fcmToken, success: false, error: e.message }))
      )
    );

    const sent = details.filter(d => d.success).length;
    const failed = details.filter(d => !d.success).length;
    return res.status(200).json({ sent, failed, results: details });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});
