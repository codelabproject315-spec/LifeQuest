// Lambda: FCM REST API で通知送信（firebase-admin不要）
import { createSign } from 'crypto';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const APP_ID = process.env.VITE_APP_ID || 'lifequest';
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// JWT生成（Google OAuth2用）
const makeJWT = () => {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(PRIVATE_KEY, 'base64url');
  return `${header}.${payload}.${sig}`;
};

// Google Access Token取得
const getAccessToken = async () => {
  const jwt = makeJWT();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  return data.access_token;
};

// Firestoreからユーザー取得
const getUsers = async (token) => {
  const url = `${FIRESTORE_URL}/artifacts/${APP_ID}/public/data/users`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return (data.documents || []).map(doc => {
    const fields = doc.fields || {};
    return { fcmToken: fields.fcmToken?.stringValue };
  }).filter(u => u.fcmToken);
};

// FCM通知送信
const sendNotification = async (token, fcmToken, title, body) => {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token: fcmToken,
        notification: { title, body },
        webpush: {
          notification: {
            icon: '/icon-192.png',
            tag: 'lifequest-quest',
            renotify: true,
            requireInteraction: true,
          },
          fcm_options: { link: '/' },
        },
      },
    }),
  });
  return res.ok;
};

// スケジュール生成（App.jsxと同じロジック）
const buildDailySchedule = () => {
  const seed = Math.floor(Date.now() / 86400000);
  const rng = (n) => { let x = Math.sin(seed * 9301 + n * 49297 + 233) * 100000; return x - Math.floor(x); };
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;
  const QUEST_DURATION = 5 * 60 * 1000;
  return Array.from({ length: 6 }, (_, i) => {
    const slotSize = dayMs / 6;
    const offset = slotSize * i + Math.floor(rng(i * 7 + 1) * slotSize);
    const deliverAt = todayStart.getTime() + offset;
    return { deliverAt, deadlineTs: deliverAt + QUEST_DURATION };
  });
};

export const handler = async (event) => {
  const now = Date.now();
  const isForced = event?.body ? JSON.parse(event.body)?.force === true : false;
  const customTitle = event?.body ? JSON.parse(event.body)?.title : null;
  const customBody = event?.body ? JSON.parse(event.body)?.body : null;

  if (!isForced) {
    const schedule = buildDailySchedule();
    const WINDOW = 10 * 60 * 1000;
    const dueTasks = schedule.filter(q => q.deliverAt >= now && q.deliverAt < now + WINDOW);
    if (dueTasks.length === 0) {
      console.log('No quests due');
      return { statusCode: 200, body: 'No quests due' };
    }
  }

  const accessToken = await getAccessToken();
  const users = await getUsers(accessToken);

  if (users.length === 0) {
    console.log('No users with FCM tokens');
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ sent: 0 }) };
  }

  const title = customTitle || '⚡ クエスト到着！';
  const body = customBody || '新しいクエストが届いた！5分以内にクリアせよ！';

  const results = await Promise.allSettled(
    users.map(u => sendNotification(accessToken, u.fcmToken, title, body))
  );

  const succeeded = results.filter(r => r.status === 'fulfilled' && r.value).length;
  console.log(`Sent: ${succeeded}/${users.length}`);
  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ sent: succeeded, total: users.length }),
  };
};
