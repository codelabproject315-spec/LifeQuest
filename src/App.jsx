import MapTab from './MapTab';
import PlaceFeed from './PlaceFeed'; // ← 追加
import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, getDocs, updateDoc, doc, onSnapshot, getDoc, deleteDoc } from 'firebase/firestore';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import {
  Trophy, Camera, Home, User,
  CheckCircle2, Loader2, MapPin, Zap, X, Mail, Lock,
  AlertCircle, Navigation,
  Sparkles, Users, Map, Award,
  ChevronRight, Plus, Crown, Trash2
} from 'lucide-react';

// --- Firebase 設定 ---
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const messaging = getMessaging(app);
const appId = import.meta.env.VITE_APP_ID || 'lifequest-default';
const SESSION_KEY = 'lifequest_user_v4';

// FCMトークンを取得してFirestoreに保存
const registerPushToken = async (userId) => {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    // SWを明示的に / スコープで登録（これをしないとバナーが出ない）
    const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    const token = await getToken(messaging, {
      vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });
    if (token) {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', userId), {
        fcmToken: token,
      });
    }
  } catch (e) {
    console.warn('FCM token registration failed:', e);
  }
};

// ── ユーティリティ ─────────────────────────────────────────
const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};
const formatDistance = m => {
  if (m === null || m === undefined) return '---';
  return m >= 1000 ? `${(m/1000).toFixed(1)}km` : `${Math.round(m)}m`;
};

// ── バッジ定義 ────────────────────────────────────────────
const BADGES = [
  { id: 'first_quest', name: '冒険の始まり', desc: '初クエスト達成', icon: '⚔️', condition: (u) => (u.totalCompleted || 0) >= 1 },
  { id: 'streak_3',    name: '3日連続',     desc: '3日連続ログイン', icon: '🔥', condition: (u) => (u.streak || 0) >= 3 },
  { id: 'streak_7',    name: '週の勇者',    desc: '7日連続ログイン', icon: '👑', condition: (u) => (u.streak || 0) >= 7 },
  { id: 'xp_500',      name: 'XPハンター',  desc: '累計500XP獲得',  icon: '⚡', condition: (u) => (u.totalXP || 0) >= 500 },
  { id: 'location_1',  name: '探検家',      desc: '位置クエスト達成', icon: '🗺️', condition: (u) => (u.locationCompleted || 0) >= 1 },
  { id: 'social_1',    name: '仲間と共に',  desc: '協力クエスト達成', icon: '🤝', condition: (u) => (u.coopCompleted || 0) >= 1 },
  { id: 'level_5',     name: 'ベテラン',    desc: 'レベル5到達',     icon: '🌟', condition: (u) => (u.level || 1) >= 5 },
  { id: 'ai_quest',    name: 'AI弟子',      desc: 'AIクエスト達成',  icon: '🤖', condition: (u) => (u.aiCompleted || 0) >= 1 },
];

const checkNewBadges = (user) => {
  const earned = user.badges || [];
  return BADGES.filter(b => !earned.includes(b.id) && b.condition(user)).map(b => b.id);
};

// ── XPBar ─────────────────────────────────────────────────
const XPBar = ({ xp, maxXP, level }) => {
  const pct = Math.min((xp / maxXP) * 100, 100);
  return (
    <div className="w-full">
      <div className="flex justify-between items-end mb-1">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">経験値 (XP)</span>
        <span className="text-xs font-black text-indigo-600">{xp} / {maxXP} XP</span>
      </div>
      <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200 shadow-inner">
        <div className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 transition-all duration-700 ease-out rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

// ── AuthGateway ────────────────────────────────────────────
const AuthGateway = ({ onLoginSuccess, isFirebaseReady }) => {
  const [view, setView] = useState('landing');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const handleAuth = async (e) => {
    if (e) e.preventDefault();
    if (!isFirebaseReady || loading) return;
    setLoading(true); setError('');
    try {
      const col = collection(db, 'artifacts', appId, 'public', 'data', 'users');
      const snap = await getDocs(col);
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (view === 'signup') {
        if (all.find(u => u.email === formData.email)) { setError('このメールアドレスは既に登録されています。'); setLoading(false); return; }
        const today = new Date().toDateString();
        const nu = {
          name: formData.name, email: formData.email, password: formData.password,
          xp: 0, level: 1, totalXP: 0, totalCompleted: 0, locationCompleted: 0,
          aiCompleted: 0, coopCompleted: 0, streak: 1, lastLoginDate: today,
          badges: [], friends: [],
          avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${formData.name}`,
          createdAt: Date.now()
        };
        const ref = await addDoc(col, nu);
        onLoginSuccess({ ...nu, id: ref.id });
      } else {
        const user = all.find(u => u.email === formData.email && u.password === formData.password);
        if (!user) { setError('メールアドレスまたはパスワードが間違っています。'); setLoading(false); return; }
        // ストリーク更新
        const today = new Date().toDateString();
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        let streak = user.streak || 1;
        if (user.lastLoginDate === yesterday) streak++;
        else if (user.lastLoginDate !== today) streak = 1;
        const updated = { ...user, streak, lastLoginDate: today };
        try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', user.id), { streak, lastLoginDate: today }); } catch {}
        onLoginSuccess(updated);
      }
    } catch { setError('通信エラーが発生しました。'); }
    finally { setLoading(false); }
  };

  if (view === 'landing') return (
    <div className="flex-1 flex flex-col bg-slate-900 text-white h-full relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-72 h-72 bg-indigo-600/20 rounded-full blur-3xl" />
      <div className="absolute bottom-[-10%] right-[-10%] w-72 h-72 bg-violet-600/20 rounded-full blur-3xl" />
      <div className="absolute top-1/3 right-1/4 w-32 h-32 bg-pink-600/10 rounded-full blur-2xl" />
      <div className="flex-1 flex flex-col justify-center items-center px-8 z-10 text-center">
        <div className="w-28 h-28 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-[2.5rem] flex items-center justify-center mb-8 shadow-2xl">
          <Trophy size={52} className="text-white" />
        </div>
        <h1 className="text-5xl font-black tracking-tighter mb-3 text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400">LifeQuest</h1>
        <p className="text-slate-400 text-base font-medium mb-3">現実世界を冒険フィールドに。</p>
        <div className="flex gap-2 mb-12 flex-wrap justify-center">
          {['🤖 AI生成クエスト', '🗺️ マップ探索', '👥 仲間と競う', '🏆 バッジ収集'].map(f => (
            <span key={f} className="text-[10px] px-2 py-1 rounded-full bg-white/10 text-slate-300 font-bold">{f}</span>
          ))}
        </div>
        {!isFirebaseReady
          ? <div className="flex items-center gap-2 text-indigo-300 font-bold"><Loader2 className="animate-spin" />接続中...</div>
          : <div className="w-full space-y-4">
            <button type="button" onClick={() => setView('signup')} className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all">新規登録</button>
            <button type="button" onClick={() => setView('login')} className="w-full py-5 bg-slate-800 text-slate-300 border-2 border-slate-700 rounded-2xl font-black text-lg active:scale-95 transition-all">ログイン</button>
          </div>
        }
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col p-8 bg-white h-full overflow-y-auto">
      <button type="button" onClick={() => setView('landing')} className="self-start p-2 -ml-2 text-slate-400 mb-8"><X size={28} /></button>
      <div className="mb-10 text-left">
        <h2 className="text-3xl font-black text-slate-900 mb-2">{view === 'login' ? 'おかえりなさい' : '冒険者登録'}</h2>
        <p className="text-slate-500 font-bold">{view === 'login' ? '登録情報を入力してください' : 'あなたの名前を刻んでください'}</p>
      </div>
      {error && <div className="mb-6 p-4 bg-red-50 border-2 border-red-100 rounded-2xl flex items-center gap-3 text-red-600"><AlertCircle size={20} /><p className="text-sm font-bold">{error}</p></div>}
      <form onSubmit={handleAuth} className="space-y-4">
        {view === 'signup' && (
          <div className="relative">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={20} />
            <input required type="text" placeholder="名前" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl py-4 pl-12 pr-4 font-bold outline-none focus:border-indigo-500 focus:bg-white transition-all" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
          </div>
        )}
        <div className="relative">
          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={20} />
          <input required type="email" placeholder="メールアドレス" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl py-4 pl-12 pr-4 font-bold outline-none focus:border-indigo-500 focus:bg-white transition-all" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
        </div>
        <div className="relative">
          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={20} />
          <input required type="password" placeholder="パスワード" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl py-4 pl-12 pr-4 font-bold outline-none focus:border-indigo-500 focus:bg-white transition-all" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} />
        </div>
        <button type="submit" disabled={loading} className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2 mt-4">
          {loading ? <Loader2 className="animate-spin" /> : <span>{view === 'login' ? 'ログイン' : '冒険を始める'}</span>}
        </button>
      </form>
    </div>
  );
};

// ── CameraOverlay ──────────────────────────────────────────
const CameraOverlay = ({ isOpen, onClose, onCapture }) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [camError, setCamError] = useState('');

  useEffect(() => { if (isOpen) startCamera(); return stopCamera; }, [isOpen]);
  const startCamera = async () => {
    setCamError('');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = s;
      if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.onloadedmetadata = () => { videoRef.current.play(); setIsReady(true); }; }
    } catch { setCamError('カメラへのアクセスが拒否されました。'); }
  };
  const stopCamera = () => { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; setIsReady(false); setCamError(''); };
  const handleClose = () => { stopCamera(); onClose(); };
  const handleCapture = () => {
    const canvas = document.createElement('canvas');
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    stopCamera();
    onCapture(base64);
  };
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {camError ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
          <AlertCircle size={48} className="text-red-400" />
          <p className="text-white font-bold text-center">{camError}</p>
          <button type="button" onClick={handleClose} className="mt-4 px-8 py-4 bg-white text-slate-900 rounded-2xl font-black">閉じる</button>
        </div>
      ) : (
        <>
          <video ref={videoRef} autoPlay playsInline muted className="flex-1 w-full h-full object-cover" />
          <div className="absolute inset-0 flex flex-col justify-between p-6 pointer-events-none">
            <button type="button" onClick={handleClose} className="p-3 bg-black/40 text-white rounded-full self-start pointer-events-auto active:scale-90 transition-transform"><X size={24} /></button>
            <div className="flex flex-col items-center gap-4 pointer-events-auto mb-24">
              <div className="text-white text-xs font-bold bg-black/50 px-4 py-2 rounded-full border border-white/20 backdrop-blur-sm">証拠を記録してください</div>
              <button type="button" onClick={handleCapture} disabled={!isReady} className="w-20 h-20 bg-white rounded-full border-4 border-slate-300 active:scale-90 transition-transform shadow-2xl disabled:opacity-50" />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ── GPS Hook ──────────────────────────────────────────────
const useGeolocation = () => {
  const [location, setLocation] = useState(null);
  const [gpsStatus, setGpsStatus] = useState('loading');
  const watchId = useRef(null);
  const QUEST_LAT = 35.6895;
  const QUEST_LNG = 139.6917;
  const [mockOffset, setMockOffset] = useState(500);

  const tryRealGPS = useCallback(() => {
    if (!navigator.geolocation) { setGpsStatus('mock'); return; }
    setGpsStatus('loading');
    const timeout = setTimeout(() => setGpsStatus('mock'), 5000);
    watchId.current = navigator.geolocation.watchPosition(
      pos => { clearTimeout(timeout); setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGpsStatus('ok'); },
      () => { clearTimeout(timeout); setGpsStatus('mock'); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 5000 }
    );
  }, []);

  useEffect(() => { tryRealGPS(); return () => { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); }; }, []);

  const mockLocation = { lat: QUEST_LAT + (mockOffset / 111000), lng: QUEST_LNG };
  const activeLocation = gpsStatus === 'ok' ? location : (gpsStatus === 'mock' ? mockLocation : null);
  return { location: activeLocation, gpsStatus, mockOffset, setMockOffset, retryGPS: tryRealGPS, QUEST_LAT, QUEST_LNG };
};

// ── MockGPSPanel ──────────────────────────────────────────
const MockGPSPanel = ({ mockOffset, setMockOffset, QUEST_LAT, QUEST_LNG }) => {
  const mockLocation = { lat: QUEST_LAT + (mockOffset / 111000), lng: QUEST_LNG };
  const dist = calculateDistance(mockLocation.lat, mockLocation.lng, QUEST_LAT, QUEST_LNG);
  const isUnlocked = dist <= 200;
  return (
    <div className="mx-4 mb-3 p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl text-left">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-[10px] font-black text-amber-700 uppercase tracking-wider">🎮 デモモード</span>
      </div>
      <div className="flex items-center gap-3">
        <MapPin size={14} className="text-amber-500 shrink-0" />
        <input type="range" min={0} max={800} step={10} value={mockOffset} onChange={e => setMockOffset(Number(e.target.value))} className="flex-1 accent-indigo-500" />
        <span className={`text-sm font-black w-16 text-right ${isUnlocked ? 'text-emerald-600' : 'text-slate-600'}`}>{formatDistance(dist)}</span>
      </div>
      <p className={`text-[10px] font-black mt-1 ${isUnlocked ? 'text-emerald-600' : 'text-amber-600'}`}>
        {isUnlocked ? '🔓 解放範囲内！' : `残り ${formatDistance(Math.max(0, dist - 200))}`}
      </p>
    </div>
  );
};

// ── AI Quest Generator ────────────────────────────────────
const AIQuestGenerator = ({ onAdd, currentUser }) => {
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(null);
  const [mood, setMood] = useState('');

  const generateQuest = async () => {
    setLoading(true); setGenerated(null);
    try {
      const prompt = `あなたはLifeQuestというゲームのAIクエストデザイナーです。
ユーザー情報: レベル${currentUser.level || 1}、${mood ? `気分・状況: ${mood}` : ''}
「暮らしをHack」するユニークな日常クエストを1つ考えてください。
以下のJSON形式のみで返答してください（前後に余計なテキスト不要）:
{"title":"クエスト名(10文字以内)","description":"具体的な達成条件(30文字以内)","xp":数値(10-100),"category":"健康|学習|社交|創造|冒険のいずれか","emoji":"絵文字1つ"}`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const data = await response.json();
      const text = data.content?.map(i => i.text || '').join('');
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      setGenerated(parsed);
    } catch (e) {
      setGenerated({ title: 'ランダム散歩', description: '新しいルートで15分歩く', xp: 30, category: '冒険', emoji: '🚶' });
    }
    setLoading(false);
  };

  const categoryColors = { 健康: 'bg-emerald-100 text-emerald-700', 学習: 'bg-blue-100 text-blue-700', 社交: 'bg-pink-100 text-pink-700', 創造: 'bg-purple-100 text-purple-700', 冒険: 'bg-amber-100 text-amber-700' };

  return (
    <div className="bg-gradient-to-br from-indigo-900 to-violet-900 rounded-3xl p-5 mb-5 text-white">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
          <Sparkles size={16} className="text-yellow-300" />
        </div>
        <div>
          <h4 className="font-black text-sm">AIクエスト生成</h4>
          <p className="text-indigo-300 text-[10px] font-bold">Claude が今の気分に合わせてクエストを作成</p>
        </div>
      </div>
      <input
        type="text"
        placeholder="今の気分や状況を入力（例: 眠い、元気、運動したい）"
        value={mood}
        onChange={e => setMood(e.target.value)}
        className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-sm font-bold placeholder-white/40 outline-none focus:bg-white/20 mb-3 text-white"
      />
      {generated && (
        <div className="bg-white/10 rounded-2xl p-4 mb-3 border border-white/20">
          <div className="flex items-start gap-3">
            <span className="text-3xl">{generated.emoji}</span>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${categoryColors[generated.category] || 'bg-white/20 text-white'}`}>{generated.category}</span>
              </div>
              <h5 className="font-black text-base">{generated.title}</h5>
              <p className="text-indigo-200 text-xs font-bold mt-0.5">{generated.description}</p>
              <div className="flex items-center gap-1 mt-1 text-yellow-300 font-black text-sm"><Zap size={12} />+{generated.xp} XP</div>
            </div>
          </div>
          <button type="button" onClick={() => { onAdd(generated); setGenerated(null); setMood(''); }} className="w-full mt-3 py-2.5 bg-white text-indigo-700 rounded-xl font-black text-sm active:scale-95 transition-all flex items-center justify-center gap-2">
            <Plus size={16} />クエストに追加
          </button>
        </div>
      )}
      <button type="button" onClick={generateQuest} disabled={loading} className="w-full py-3 bg-white/20 hover:bg-white/30 border border-white/30 text-white rounded-xl font-black text-sm active:scale-95 transition-all flex items-center justify-center gap-2">
        {loading ? <><Loader2 size={16} className="animate-spin" />生成中...</> : <><Sparkles size={16} />クエストを生成</>}
      </button>
    </div>
  );
};

// ── Social Tab ────────────────────────────────────────────
const SocialTab = ({ currentUser, allUsers, onUpdateUser, db, appId }) => { // ← db, appId を追加
  const [tab, setTab] = useState('ranking');
  const [coopQuests] = useState([
    { id: 'c1', title: '朝5時起き', desc: '早起きチャレンジ', xp: 80, participants: 3, emoji: '🌅' },
    { id: 'c2', title: '週3運動', desc: '今週3回運動する', xp: 120, participants: 7, emoji: '💪' },
    { id: 'c3', title: '読書リレー', desc: '本を1冊読んで感想を共有', xp: 60, participants: 2, emoji: '📚' },
  ]);
  const [joining, setJoining] = useState(null);

  const sorted = [...allUsers].sort((a, b) => (b.totalXP || b.xp || 0) - (a.totalXP || a.xp || 0));
  const myRank = sorted.findIndex(u => u.id === currentUser.id) + 1;

  const handleJoin = async (q) => {
    setJoining(q.id);
    await new Promise(r => setTimeout(r, 1200));
    const updated = { ...currentUser, coopCompleted: (currentUser.coopCompleted || 0) + 1, xp: (currentUser.xp || 0) + q.xp, totalXP: (currentUser.totalXP || 0) + q.xp };
    onUpdateUser(updated);
    setJoining(null);
  };

  return (
    <div className="px-4 py-2">
      <div className="flex items-center gap-3 mb-4">
        <h3 className="font-black text-lg text-slate-800 tracking-tight">ソーシャル</h3>
        {myRank > 0 && <span className="text-xs font-black px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">現在 {myRank}位</span>}
      </div>
      <div className="flex gap-2 mb-4">
        {/* ← feedタブを追加 */}
        {[['ranking', '🏆 ランキング'], ['feed', '📷 フィード'], ['coop', '🤝 協力クエスト']].map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`flex-1 py-2 rounded-xl font-black text-xs transition-all ${tab === key ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-100 text-slate-500'}`}>{label}</button>
        ))}
      </div>

      {tab === 'ranking' && (
        <div className="bg-white rounded-3xl overflow-hidden border border-slate-100 shadow-sm">
          {sorted.slice(0, 10).map((u, i) => {
            const isMe = u.id === currentUser.id;
            const medals = ['🥇', '🥈', '🥉'];
            return (
              <div key={u.id} className={`p-4 border-b border-slate-50 flex items-center gap-3 last:border-0 ${isMe ? 'bg-indigo-50 border-l-4 border-l-indigo-500' : ''}`}>
                <span className="w-6 text-center font-black text-sm">{medals[i] || `${i + 1}`}</span>
                <img src={u.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.name}`} className="w-8 h-8 rounded-xl" alt="" />
                <div className="flex-1 text-left">
                  <p className="font-bold text-sm text-slate-800">{u.name}{isMe ? ' (あなた)' : ''}</p>
                  <p className="text-[10px] text-slate-400 font-bold">Lv.{u.level || 1} · 🔥{u.streak || 0}日</p>
                </div>
                <span className="font-black text-indigo-600 text-sm">{u.totalXP || u.xp || 0} XP</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ← feedタブの表示 */}
      {tab === 'feed' && (
        <PlaceFeed db={db} appId={appId} currentUserId={currentUser.id} />
      )}

      {tab === 'coop' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-400 font-bold text-left">みんなで一緒に達成するクエスト</p>
          {coopQuests.map(q => (
            <div key={q.id} className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
              <div className="flex items-start gap-3 mb-3">
                <span className="text-3xl">{q.emoji}</span>
                <div className="flex-1 text-left">
                  <h4 className="font-black text-sm text-slate-800">{q.title}</h4>
                  <p className="text-xs text-slate-500 font-bold">{q.desc}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs font-black text-amber-500">⚡+{q.xp} XP</span>
                    <span className="text-xs font-bold text-slate-400">👥 {q.participants}人参加中</span>
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => handleJoin(q)} disabled={joining === q.id} className="w-full py-2.5 bg-indigo-600 text-white rounded-xl font-black text-xs active:scale-95 transition-all flex items-center justify-center gap-2 shadow-sm">
                {joining === q.id ? <><Loader2 size={14} className="animate-spin" />参加中...</> : <><Users size={14} />参加する</>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── VRM 3Dプレビュー ──────────────────────────────────────
const VRMPreview = ({ modelPath, isSelected, onClick, label, locked, requiredXP }) => {
  const canvasRef = React.useRef(null);
  const rendererRef = React.useRef(null);
  const animFrameRef = React.useRef(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let vrm = null;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    camera.position.set(0, 1.4, 3.5);
    camera.lookAt(0, 1.0, 0);

    scene.add(new THREE.DirectionalLight(0xffffff, 1.2));
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(120, 160);
    renderer.setPixelRatio(window.devicePixelRatio);
    rendererRef.current = renderer;

    const loader = new GLTFLoader();
    loader.register(p => new VRMLoaderPlugin(p));
    loader.load(modelPath, (gltf) => {
      vrm = gltf.userData.vrm;
      VRMUtils.rotateVRM0(vrm);
      vrm.scene.scale.set(1, 1, 1);
      if (modelPath === '/model3.vrm') {
        vrm.scene.rotation.y = Math.PI;
      }
      scene.add(vrm.scene);
    });

    let t = 0;
    const clock = new THREE.Clock();
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      t += delta;
      if (vrm) {
        vrm.update(delta);
        vrm.scene.rotation.y = Math.sin(t * 0.5) * 0.4 + (modelPath === '/model3.vrm' ? Math.PI : 0);
        const h = vrm.humanoid;
        if (h) {
          const lUA = h.getNormalizedBoneNode('leftUpperArm');
          const rUA = h.getNormalizedBoneNode('rightUpperArm');
          if (modelPath === '/model3.vrm') {
            if (lUA) lUA.rotation.z = -Math.PI * 1.6;
            if (rUA) rUA.rotation.z =  Math.PI * 1.6;
          } else {
            if (lUA) lUA.rotation.z = -Math.PI * 0.4;
            if (rUA) rUA.rotation.z =  Math.PI * 0.4;
          }
        }
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      renderer.dispose();
      if (vrm) VRMUtils.deepDispose(vrm.scene);
    };
  }, [modelPath]);

  return (
    <button type="button" onClick={locked ? undefined : onClick} disabled={locked}
      className={`flex flex-col items-center gap-1.5 rounded-2xl p-2 border-2 transition-all ${locked ? 'border-slate-200 bg-slate-100 opacity-70 cursor-not-allowed' : isSelected ? 'border-indigo-500 bg-indigo-50 shadow-md active:scale-95' : 'border-slate-100 bg-slate-50 active:scale-95'}`}>
      <div className="relative" style={{ width: 120, height: 160 }}>
        <canvas ref={canvasRef} width={120} height={160} className="rounded-xl" style={{ width: 120, height: 160, filter: locked ? 'grayscale(1) blur(1px)' : 'none' }} />
        {locked && (
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-black/40">
            <span className="text-2xl">🔒</span>
            <span className="text-white text-[11px] font-black mt-1">{requiredXP}XP</span>
          </div>
        )}
      </div>
      <span className={`text-xs font-black ${locked ? 'text-slate-400' : isSelected ? 'text-indigo-600' : 'text-slate-500'}`}>{label}</span>
      {isSelected && !locked && <span className="text-[10px] text-indigo-400 font-bold">✓ 選択中</span>}
      {locked && <span className="text-[10px] text-slate-400 font-bold">ロック中</span>}
    </button>
  );
};

const VRM_CHARACTERS = [
  { path: '/model.vrm',  label: 'まさと', requiredXP: 0 },
  { path: '/model1.vrm', label: 'ゆい',   requiredXP: 0 },
  { path: '/model2.vrm', label: 'めい',   requiredXP: 500 },
  { path: '/model3.vrm', label: 'りこ',   requiredXP: 1000 },
  { path: '/model4.vrm', label: 'はやと', requiredXP: 1500 },
];

// ── ProfileEditModal ──────────────────────────────────────
const AVATAR_SEEDS = ['adventurer','hero','ninja','wizard','knight','samurai','ranger','mage','rogue','paladin','bard','druid'];

const ProfileEditModal = ({ currentUser, onSave, onClose, db, appId }) => {
  const [name, setName] = useState(currentUser.name);
  const [email, setEmail] = useState(currentUser.email);
  const [password, setPassword] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(currentUser.avatar);
  const [selectedModel, setSelectedModel] = useState(currentUser.modelPath || '/model.vrm');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!name.trim() || !email.trim()) { setError('名前とメールアドレスは必須です'); return; }
    setSaving(true); setError('');
    try {
      const col = collection(db, 'artifacts', appId, 'public', 'data', 'users');
      const snap = await getDocs(col);
      const others = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.id !== currentUser.id);
      if (others.find(u => u.email === email)) { setError('このメールアドレスは既に使われています'); setSaving(false); return; }
      const updated = {
        ...currentUser,
        name: name.trim(),
        email: email.trim(),
        avatar: selectedAvatar,
        modelPath: selectedModel,
        ...(password ? { password } : {}),
      };
      await onSave(updated);
      onClose();
    } catch { setError('保存に失敗しました'); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md bg-white rounded-t-3xl p-6 pb-10 overflow-y-auto" style={{ maxHeight: '90vh' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-black text-lg text-slate-800">プロフィール編集</h2>
          <button type="button" onClick={onClose} className="p-2 rounded-full bg-slate-100 text-slate-400 active:scale-90 transition-transform"><X size={18} /></button>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-xs font-bold flex items-center gap-2"><AlertCircle size={14} />{error}</div>}

        <p className="text-xs font-black text-slate-500 mb-3 uppercase tracking-wider">キャラクター</p>
        <div className="grid grid-cols-3 gap-3 mb-5">
          {VRM_CHARACTERS.map(c => {
            const locked = (currentUser.totalXP || 0) < c.requiredXP;
            return (
              <VRMPreview
                key={c.path}
                modelPath={c.path}
                label={c.label}
                isSelected={selectedModel === c.path}
                onClick={() => !locked && setSelectedModel(c.path)}
                locked={locked}
                requiredXP={c.requiredXP}
              />
            );
          })}
        </div>

        <p className="text-xs font-black text-slate-500 mb-2 uppercase tracking-wider">アバター</p>
        <div className="grid grid-cols-6 gap-2 mb-5">
          {AVATAR_SEEDS.map(seed => {
            const url = `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;
            const isSelected = selectedAvatar === url;
            return (
              <button key={seed} type="button" onClick={() => setSelectedAvatar(url)}
                className={`rounded-xl border-2 p-0.5 transition-all active:scale-90 ${isSelected ? 'border-indigo-500 shadow-md' : 'border-slate-100'}`}>
                <img src={url} className="w-full aspect-square rounded-lg" alt={seed} />
              </button>
            );
          })}
        </div>

        <p className="text-xs font-black text-slate-500 mb-1 uppercase tracking-wider">名前</p>
        <div className="relative mb-4">
          <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
          <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl py-3 pl-10 pr-4 font-bold text-sm outline-none focus:border-indigo-500 focus:bg-white transition-all" />
        </div>

        <p className="text-xs font-black text-slate-500 mb-1 uppercase tracking-wider">メールアドレス</p>
        <div className="relative mb-4">
          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl py-3 pl-10 pr-4 font-bold text-sm outline-none focus:border-indigo-500 focus:bg-white transition-all" />
        </div>

        <p className="text-xs font-black text-slate-500 mb-1 uppercase tracking-wider">パスワード（変更する場合のみ）</p>
        <div className="relative mb-6">
          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="入力しない場合は変更なし" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl py-3 pl-10 pr-4 font-bold text-sm outline-none focus:border-indigo-500 focus:bg-white transition-all placeholder-slate-300" />
        </div>

        <button type="button" onClick={handleSave} disabled={saving} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-sm active:scale-95 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-60">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          {saving ? '保存中...' : '保存する'}
        </button>
      </div>
    </div>
  );
};

// ── Badges Tab ────────────────────────────────────────────
const BadgesTab = ({ currentUser, maxXP, handleLogout, onEditProfile }) => {
  const earned = currentUser.badges || [];
  const today = new Date();
  const streakDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (6 - i));
    return { label: ['日', '月', '火', '水', '木', '金', '土'][d.getDay()], active: i >= (7 - (currentUser.streak || 0)) };
  });

  return (
    <div className="px-4 py-2">
      {/* プロフィールカード */}
      <div className="bg-white rounded-3xl p-4 mb-3 border border-slate-100 shadow-sm flex items-center gap-3">
        <img src={currentUser.avatar} className="w-14 h-14 rounded-2xl border-2 border-indigo-200" alt="" />
        <div className="flex-1 text-left">
          <h3 className="font-black text-base text-slate-900">{currentUser.name}</h3>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-700 text-[10px] font-black">Lv.{currentUser.level}</span>
            {(currentUser.streak || 0) > 0 && <span className="text-[10px] font-black text-orange-500">🔥{currentUser.streak}日</span>}
            <span className="text-[10px] font-black text-indigo-500">総XP {currentUser.totalXP || 0}</span>
          </div>
          <div className="mt-1.5">
            <XPBar xp={currentUser.xp || 0} maxXP={maxXP} level={currentUser.level} />
          </div>
        </div>
      </div>

      {/* 編集ボタン */}
      <button type="button" onClick={onEditProfile} className="w-full py-2.5 mb-2 bg-indigo-50 text-indigo-600 font-black text-sm rounded-2xl active:scale-95 transition-all border border-indigo-100">
        ✏️ プロフィールを編集
      </button>

      {/* ログアウト（誤操作防止のため離して配置） */}
      <button type="button" onClick={handleLogout} className="w-full py-2 mb-4 bg-slate-50 text-slate-400 font-bold text-xs rounded-2xl active:scale-95 transition-all border border-slate-100">
        ログアウト
      </button>

      {/* ストリーク */}
      <div className="bg-gradient-to-br from-orange-500 to-rose-500 rounded-3xl p-5 mb-5 text-white">
        <div className="flex items-center justify-between mb-4">
          <div className="text-left">
            <p className="text-white/70 text-xs font-bold uppercase tracking-wider">現在のストリーク</p>
            <p className="text-4xl font-black">{currentUser.streak || 0}<span className="text-xl ml-1">🔥</span></p>
            <p className="text-white/80 text-xs font-bold">日連続ログイン</p>
          </div>
          <div className="text-right">
            <p className="text-white/70 text-xs font-bold">最高</p>
            <p className="text-2xl font-black">{Math.max(currentUser.streak || 0, currentUser.bestStreak || 0)}日</p>
          </div>
        </div>
        <div className="flex gap-1.5">
          {streakDays.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className={`w-full aspect-square rounded-lg flex items-center justify-center text-xs font-black ${d.active ? 'bg-white text-orange-500' : 'bg-white/20 text-white/50'}`}>
                {d.active ? '🔥' : '·'}
              </div>
              <span className="text-[9px] text-white/60 font-bold">{d.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 統計 */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        {[
          { label: '達成数', value: currentUser.totalCompleted || 0, icon: '⚔️' },
          { label: '累計XP', value: currentUser.totalXP || 0, icon: '⚡' },
          { label: 'レベル', value: currentUser.level || 1, icon: '⭐' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl p-3 text-center border border-slate-100 shadow-sm">
            <p className="text-2xl mb-1">{s.icon}</p>
            <p className="font-black text-lg text-slate-800">{s.value}</p>
            <p className="text-[10px] text-slate-400 font-bold">{s.label}</p>
          </div>
        ))}
      </div>

      {/* バッジ */}
      <h4 className="font-black text-sm text-slate-600 mb-3 uppercase tracking-wider text-left">バッジコレクション</h4>
      <div className="grid grid-cols-4 gap-2">
        {BADGES.map(b => {
          const isEarned = earned.includes(b.id);
          return (
            <div key={b.id} className={`rounded-2xl p-3 text-center border-2 transition-all ${isEarned ? 'bg-amber-50 border-amber-200 shadow-sm' : 'bg-slate-50 border-slate-100 opacity-50'}`}>
              <p className={`text-2xl mb-1 ${isEarned ? '' : 'grayscale'}`} style={{ filter: isEarned ? 'none' : 'grayscale(100%)' }}>{b.icon}</p>
              <p className="text-[9px] font-black text-slate-600 leading-tight">{b.name}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── ランク定義 ────────────────────────────────────────────
const RANKS = {
  D: { label: 'D', color: 'text-slate-500', bg: 'bg-slate-100', border: 'border-slate-200', glow: '', xpMult: 1.0 },
  C: { label: 'C', color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', glow: '', xpMult: 1.2 },
  B: { label: 'B', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', glow: '', xpMult: 1.5 },
  A: { label: 'A', color: 'text-violet-600', bg: 'bg-violet-50', border: 'border-violet-200', glow: 'shadow-violet-100', xpMult: 2.0 },
  S: { label: 'S', color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-300', glow: 'shadow-amber-100', xpMult: 3.0 },
};

// ── デイリークエストプール（50種以上） ──────────────────────
const QUEST_POOL = [
  // ── D ランク ──────────────────────────────────────────────
  { id: 'q_water',    title: '水分補給',           description: 'コップ1杯の水を飲む',                xp: 3,  rank: 'D', emoji: '💧', category: '健康' },
  { id: 'q_breath',   title: '深呼吸',             description: 'ゆっくり10回深呼吸する',              xp: 3,  rank: 'D', emoji: '🌬️', category: '健康' },
  { id: 'q_posture',  title: '姿勢を正す',         description: '背筋を伸ばして5分座る',               xp: 3,  rank: 'D', emoji: '🪑', category: '健康' },
  { id: 'q_photo',    title: '空の写真',           description: '今日の空を撮影する',                  xp: 4,  rank: 'D', emoji: '☁️', category: '創造' },
  { id: 'q_smile',    title: '鏡で笑顔',           description: '鏡の前で30秒笑顔を作る',              xp: 3,  rank: 'D', emoji: '😄', category: '健康' },
  { id: 'q_desk',     title: '机を整理',           description: 'デスク周りを30秒片付ける',            xp: 3,  rank: 'D', emoji: '🗂️', category: '創造' },
  { id: 'q_gratitude',title: '感謝を書く',         description: '今日感謝したことを1つメモ',           xp: 3,  rank: 'D', emoji: '🙏', category: '社交' },
  { id: 'q_outside',  title: '外を見る',           description: '窓から1分外の景色を眺める',            xp: 3,  rank: 'D', emoji: '🌿', category: '冒険' },
  { id: 'q_music',    title: '音楽を聴く',         description: '好きな曲を1曲フルで聴く',              xp: 3,  rank: 'D', emoji: '🎵', category: '創造' },
  { id: 'q_hand',     title: '手洗い',             description: '丁寧に20秒手を洗う',                  xp: 3,  rank: 'D', emoji: '🧼', category: '健康' },

  // ── C ランク ──────────────────────────────────────────────
  { id: 'q_stretch',  title: 'ストレッチ',         description: '肩・首・腰を各30秒伸ばす',            xp: 6, rank: 'C', emoji: '🧘', category: '健康', chainNext: 'q_walk' },
  { id: 'q_walk',     title: '外を歩く',           description: '10分間外の空気を吸いながら歩く',       xp: 7, rank: 'C', emoji: '🚶', category: '健康' },
  { id: 'q_note',     title: '学びをメモ',         description: '今日学んだことを3行で書く',            xp: 6, rank: 'C', emoji: '✏️', category: '学習' },
  { id: 'q_clean',    title: '部屋を掃除',         description: '床を掃いて綺麗にする',                xp: 7, rank: 'C', emoji: '🧹', category: '創造' },
  { id: 'q_veg',      title: '野菜を食べる',       description: '食事に野菜を1品以上入れる',            xp: 6, rank: 'C', emoji: '🥦', category: '健康' },
  { id: 'q_call',     title: '誰かに連絡',         description: '友人・家族にメッセージを送る',         xp: 7, rank: 'C', emoji: '📱', category: '社交' },
  { id: 'q_sketch',   title: '何かを描く',         description: '紙に落書き・スケッチをする',           xp: 6, rank: 'C', emoji: '✏️', category: '創造' },
  { id: 'q_news',     title: 'ニュースを読む',     description: '今日のニュースを1記事読む',            xp: 6, rank: 'C', emoji: '📰', category: '学習' },
  { id: 'q_cook',     title: '自炊する',           description: '何か一品自分で作って食べる',           xp: 8, rank: 'C', emoji: '🍳', category: '健康' },
  { id: 'q_plant',    title: '植物に水やり',       description: '植物や花に水をあげる',                xp: 5,  rank: 'C', emoji: '🌱', category: '創造' },
  { id: 'q_compliment',title: '誰かを褒める',      description: '一人に対して心からの褒め言葉を伝える', xp: 7, rank: 'C', emoji: '💬', category: '社交' },

  // ── B ランク ──────────────────────────────────────────────
  { id: 'q_study',    title: '30分勉強',           description: '集中して30分取り組む',                xp: 10, rank: 'B', emoji: '📖', category: '学習', chainNext: 'q_note' },
  { id: 'q_read',     title: '読書20分',           description: '本・記事を20分以上読む',               xp: 9, rank: 'B', emoji: '📚', category: '学習' },
  { id: 'q_run',      title: 'ジョギング',         description: '20分走るか早歩きする',                xp: 10, rank: 'B', emoji: '🏃', category: '健康', chainNext: 'q_stretch' },
  { id: 'q_new',      title: '新しいルート',       description: 'いつもと違う道で目的地へ',             xp: 9, rank: 'B', emoji: '🗺️', category: '冒険' },
  { id: 'q_cook2',    title: '新メニューに挑戦',   description: '作ったことない料理を作る',             xp: 10, rank: 'B', emoji: '👨‍🍳', category: '創造' },
  { id: 'q_help',     title: '誰かを手伝う',       description: '頼まれてない事でも誰かを助ける',       xp: 9, rank: 'B', emoji: '🤝', category: '社交' },
  { id: 'q_plan',     title: '明日の計画',         description: '明日やることを3つリストアップ',        xp: 8, rank: 'B', emoji: '📋', category: '学習' },
  { id: 'q_digital',  title: 'デジタルデトックス', description: 'SNSを1時間封印して過ごす',             xp: 9, rank: 'B', emoji: '📵', category: '健康' },
  { id: 'q_photo2',   title: '作品を撮る',         description: '美しいと感じたものを3枚撮影',          xp: 8, rank: 'B', emoji: '📷', category: '創造' },
  { id: 'q_talk',     title: '深い会話',           description: '誰かと10分以上真剣な話をする',         xp: 10, rank: 'B', emoji: '💭', category: '社交' },

  // ── A ランク ──────────────────────────────────────────────
  { id: 'q_morning',  title: '早起き',             description: '7時前に起きて朝日を浴びる',            xp: 10, rank: 'A', emoji: '🌅', category: '健康', chainNext: 'q_walk' },
  { id: 'q_exercise', title: '本格運動',           description: '30分以上の運動・筋トレをする',         xp: 10, rank: 'A', emoji: '💪', category: '健康' },
  { id: 'q_learn',    title: '新技術を学ぶ',       description: '新しいスキルを1時間勉強する',           xp: 10, rank: 'A', emoji: '🧠', category: '学習', chainNext: 'q_note' },
  { id: 'q_stranger', title: '知らない人と話す',   description: '見知らぬ人に話しかけてみる',           xp: 10, rank: 'A', emoji: '🌐', category: '社交' },
  { id: 'q_create',   title: '作品を作る',         description: '何か創作物（絵・文・音楽）を完成',     xp: 10, rank: 'A', emoji: '🎨', category: '創造' },
  { id: 'q_fast',     title: '断食チャレンジ',     description: '16時間以上食事を控える',               xp: 10, rank: 'A', emoji: '⏳', category: '健康' },
  { id: 'q_mentor',   title: '誰かを教える',       description: '自分の知識を他の人に教える',           xp: 10, rank: 'A', emoji: '👨‍🏫', category: '社交' },
  { id: 'q_explore',  title: '未知の場所へ',       description: '行ったことのない場所に一人で行く',     xp: 10, rank: 'A', emoji: '🧭', category: '冒険' },

  // ── S ランク ──────────────────────────────────────────────
  { id: 'q_urgent1',  title: '緊急！5分瞑想',      description: '今すぐ5分間目を閉じて集中',            xp: 6, rank: 'S', emoji: '⚡', category: '健康', isUrgent: true, timeLimit: 300 },
  { id: 'q_urgent2',  title: '緊急！即断捨離',     description: '今すぐ不要なもの3つを捨てる',          xp: 6, rank: 'S', emoji: '🗑️', category: '創造', isUrgent: true, timeLimit: 600 },
  { id: 'q_urgent3',  title: '緊急！感謝メッセ',   description: '今すぐ誰かに感謝を伝える',             xp: 6, rank: 'S', emoji: '💌', category: '社交', isUrgent: true, timeLimit: 300 },
  { id: 'q_sunrise',  title: '日の出を見る',       description: '日の出の時間に外で空を見る',            xp: 6, rank: 'S', emoji: '🌄', category: '冒険' },
  { id: 'q_cold',     title: '冷水シャワー',       description: '30秒以上冷たい水を浴びる',             xp: 6, rank: 'S', emoji: '🚿', category: '健康' },
  { id: 'q_nophone',  title: '半日スマホなし',     description: '6時間スマホを触らない',                xp: 6, rank: 'S', emoji: '📴', category: '健康' },
  { id: 'q_volunteer',title: 'ボランティア',       description: '誰かのために無償で1時間働く',          xp: 6, rank: 'S', emoji: '❤️', category: '社交' },

  // ── 位置クエスト ──────────────────────────────────────────
  { id: 'q_lib',      title: '図書館へ行く',       description: '図書館エリアに足を運ぶ',               xp: 9, rank: 'B', emoji: '🏛️', category: '冒険', type: 'location', lat: 35.6895, lng: 139.6917, radius: 200 },
];

// ── 1日6回・時間ランダム配信ロジック ─────────────────────────
const DAILY_QUEST_KEY = 'lifequest_daily_v3';
const QUEST_DURATION = 5 * 60 * 1000; // 5分（ms）

const buildDailySchedule = () => {
  const seed = Math.floor(Date.now() / 86400000);
  const rng = (n) => { let x = Math.sin(seed * 9301 + n * 49297 + 233) * 100000; return x - Math.floor(x); };

  const byRank = (rank) => QUEST_POOL.filter(q => q.rank === rank && !q.isUrgent && q.type !== 'location');
  const pickN = (arr, n) => [...arr].sort((a, b) => rng(a.id.charCodeAt(3) || 0) - rng(b.id.charCodeAt(3) || 0)).slice(0, n);

  // 6クエスト選出: D×1, C×1, B×1, A×1, S緊急×1, 位置×1
  const picked = [
    ...pickN(byRank('D'), 1),
    ...pickN(byRank('C'), 1),
    ...pickN(byRank('B'), 1),
    ...pickN(byRank('A'), 1),
  ];
  const urgentPool = QUEST_POOL.filter(q => q.isUrgent);
  picked.push(urgentPool[Math.floor(rng(999) * urgentPool.length)]);
  picked.push(QUEST_POOL.find(q => q.type === 'location'));

  // 今日の0時〜23:55の間でランダムな配信時刻を6つ生成（重複しないよう分散）
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const dayMs = 24 * 60 * 60 * 1000;
  const slots = picked.map((_, i) => {
    // 1日を6等分し、各枠内でランダムな時刻
    const slotSize = dayMs / 6;
    const offset = slotSize * i + Math.floor(rng(i * 7 + 1) * slotSize);
    return todayStart.getTime() + offset;
  }).sort((a, b) => a - b);

  return picked.map((q, i) => ({
    ...q,
    deliverAt: slots[i],           // この時刻に出現
    deadlineTs: slots[i] + QUEST_DURATION, // 5分後に消える
  }));
};

const getOrBuildSchedule = () => {
  const todayKey = new Date().toDateString();
  try {
    const saved = localStorage.getItem(DAILY_QUEST_KEY);
    if (saved) {
      const { dateKey, schedule } = JSON.parse(saved);
      if (dateKey === todayKey) return schedule;
    }
  } catch {}
  const schedule = buildDailySchedule();
  try { localStorage.setItem(DAILY_QUEST_KEY, JSON.stringify({ dateKey: todayKey, schedule })); } catch {}
  return schedule;
};

// 現時点で表示すべきクエスト（deliverAt済み & deadlineTs未超過 & 未完了）
const getActiveQuests = (schedule, completedIds) => {
  const now = Date.now();
  return schedule.filter(q => q.deliverAt <= now && q.deadlineTs > now && !completedIds.includes(q.id));
};

// ── CountdownTimer ────────────────────────────────────────
const CountdownTimer = ({ deadlineTs, onExpire }) => {
  const [remaining, setRemaining] = useState(Math.max(0, Math.floor((deadlineTs - Date.now()) / 1000)));
  useEffect(() => {
    if (remaining <= 0) { onExpire?.(); return; }
    const t = setInterval(() => {
      const r = Math.max(0, Math.floor((deadlineTs - Date.now()) / 1000));
      setRemaining(r);
      if (r <= 0) { clearInterval(t); onExpire?.(); }
    }, 1000);
    return () => clearInterval(t);
  }, [deadlineTs]);
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  const urgent = remaining < 60;
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black ${urgent ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-orange-100 text-orange-600'}`}>
      <span>⏱</span>
      <span>{m}:{String(s).padStart(2, '0')}</span>
    </div>
  );
};

// ── 自己申告クエスト（常時承認・ランク最低XP）────────────────
const SELF_REPORT_QUESTS = new Set([
  'q_breath', 'q_compliment', 'q_help', 'q_digital',
  'q_fast', 'q_urgent1', 'q_nophone',
]);

// ランクごとの最低XP（xpMult適用前）
const RANK_MIN_XP = { D: 3, C: 5, B: 8, A: 10, S: 6 };

// ── AWS Rekognition 判定 ──────────────────────────────────────
const REKOGNITION_LABELS = {
  q_water:     { required: ['Cup', 'Bottle', 'Beverage', 'Drink', 'Water'],           hint: 'コップや飲み物を撮ってください' },
  q_posture:   { required: ['Person', 'Chair'],                                        hint: '椅子に座っている自分を撮ってください' },
  q_photo:     { required: ['Sky', 'Cloud', 'Outdoors'],                               hint: '空や雲を撮ってください' },
  q_smile:     { required: ['Person'],                                                  hint: '鏡に映った笑顔の自分を撮ってください' },
  q_desk:      { required: ['Desk', 'Table', 'Furniture'],                             hint: '整理した机やテーブルを撮ってください' },
  q_gratitude: { required: ['Text', 'Paper', 'Handwriting', 'Pen'],                   hint: '感謝を書いたメモや手帳を撮ってください' },
  q_outside:   { required: ['Outdoors', 'Nature', 'Window', 'Sky'],                   hint: '窓の外の景色や自然を撮ってください' },
  q_music:     { required: ['Headphones', 'Earphone', 'Speaker'],                     hint: 'イヤホン・ヘッドホン・スピーカーを撮ってください' },
  q_hand:      { required: ['Sink', 'Hand', 'Soap'],                                  hint: '手洗い中の手や洗面台を撮ってください' },
  q_stretch:   { required: ['Person', 'Exercise', 'Yoga', 'Stretching'],              hint: 'ストレッチしている自分を撮ってください' },
  q_walk:      { required: ['Outdoors', 'Road', 'Path', 'Street'],                    hint: '歩いている道や外の景色を撮ってください' },
  q_note:      { required: ['Text', 'Paper', 'Notebook', 'Pen'],                      hint: '書いたメモやノートを撮ってください' },
  q_clean:     { required: ['Broom', 'Vacuum Cleaner', 'Mop', 'Cleaning'],            hint: 'ほうきや掃除機など掃除道具を撮ってください' },
  q_veg:       { required: ['Vegetable', 'Salad', 'Food', 'Plant'],                   hint: '野菜が入った食事を撮ってください' },
  q_call:      { required: ['Phone', 'Screen', 'Text'],                               hint: 'メッセージ画面やスマホを撮ってください' },
  q_sketch:    { required: ['Drawing', 'Pen', 'Pencil', 'Paper', 'Art'],              hint: '描いた絵や落書きを撮ってください' },
  q_news:      { required: ['Screen', 'Text', 'Newspaper', 'Book'],                   hint: '読んでいる記事の画面や新聞を撮ってください' },
  q_cook:      { required: ['Food', 'Cooking', 'Pan', 'Kitchen', 'Meal'],             hint: '作った料理やキッチンを撮ってください' },
  q_plant:     { required: ['Plant', 'Flower', 'Potted Plant'],                       hint: '水をあげた植物や花を撮ってください' },
  q_compliment:{ required: [],                                                          hint: '完了ボタンを押してください' },
  q_study:     { required: ['Book', 'Text', 'Reading', 'Notebook'],                   hint: '勉強中のノートや教材を撮ってください' },
  q_read:      { required: ['Book', 'Text', 'Reading'],                               hint: '読んでいる本や記事を撮ってください' },
  q_run:       { required: ['Person', 'Running', 'Jogging', 'Road', 'Outdoors'],      hint: 'ジョギング中の道や自分を撮ってください' },
  q_new:       { required: ['Outdoors', 'Street', 'Road', 'Path'],                    hint: '歩いている新しいルートの道を撮ってください' },
  q_cook2:     { required: ['Food', 'Cooking', 'Pan', 'Kitchen', 'Meal'],             hint: '挑戦した新メニューを撮ってください' },
  q_help:      { required: [],                                                          hint: '完了ボタンを押してください' },
  q_plan:      { required: ['Text', 'Paper', 'Notebook', 'Pen'],                      hint: '書いた明日の計画リストを撮ってください' },
  q_digital:   { required: [],                                                          hint: '完了ボタンを押してください' },
  q_photo2:    { required: ['Outdoors', 'Architecture', 'Nature', 'Art'],              hint: '美しいと感じたものを撮ってください' },
  q_talk:      { required: ['Person'],                                                  hint: '話し相手と一緒に写った写真を撮ってください' },
  q_morning:   { required: ['Sky', 'Sunrise', 'Sunlight', 'Outdoors'],                hint: '朝日や朝の空を撮ってください' },
  q_exercise:  { required: ['Exercise', 'Sport', 'Gym', 'Dumbbell', 'Person'],        hint: '運動・筋トレしている自分や器具を撮ってください' },
  q_learn:     { required: ['Book', 'Text', 'Screen', 'Notebook'],                    hint: '学習中の画面やノートを撮ってください' },
  q_stranger:  { required: ['Person'],                                                  hint: '話しかけた人と一緒に写った写真を撮ってください' },
  q_create:    { required: ['Drawing', 'Art', 'Paper', 'Pen', 'Music'],               hint: '完成した作品（絵・文・楽器など）を撮ってください' },
  q_fast:      { required: [],                                                          hint: '完了ボタンを押してください' },
  q_mentor:    { required: ['Person'],                                                  hint: '教えている様子や相手と一緒に写った写真を撮ってください' },
  q_explore:   { required: ['Outdoors', 'Building', 'Street', 'Road'],                hint: '行ったことのない場所の景色を撮ってください' },
  q_urgent1:   { required: [],                                                          hint: '完了ボタンを押してください' },
  q_urgent2:   { required: ['Trash', 'Garbage', 'Bag', 'Box', 'Waste'],               hint: '捨てるものやゴミ袋を撮ってください' },
  q_urgent3:   { required: ['Phone', 'Screen', 'Text'],                               hint: '送った感謝メッセージの画面を撮ってください' },
  q_sunrise:   { required: ['Sky', 'Sunrise', 'Sunlight', 'Outdoors'],                hint: '日の出や朝焼けの空を撮ってください' },
  q_cold:      { required: ['Shower', 'Bathroom', 'Water', 'Sink'],                   hint: 'シャワーや浴室を撮ってください' },
  q_nophone:   { required: [],                                                          hint: '完了ボタンを押してください' },
  q_volunteer: { required: ['Person'],                                                  hint: 'ボランティア活動の様子を撮ってください' },
  q_lib:       { required: ['Book', 'Library', 'Building', 'Shelf'],                  hint: '図書館の建物や本棚を撮ってください' },
};

const judgePhotoWithRekognition = async (questId, imageBase64) => {
  // 自己申告クエストはRekognition呼ばず即承認
  if (SELF_REPORT_QUESTS.has(questId)) {
    return { approved: true, message: '自己申告で承認', xpBonus: 0, selfReport: true };
  }
  try {
    const REGION = import.meta.env.VITE_AWS_REGION || 'ap-northeast-1';
    const ACCESS_KEY = import.meta.env.VITE_AWS_ACCESS_KEY_ID || '';
    const SECRET_KEY = import.meta.env.VITE_AWS_SECRET_ACCESS_KEY || '';

    // AWS Signature V4 署名
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
    const dateStamp = amzDate.slice(0, 8);
    const service = 'rekognition';
    const host = `${service}.${REGION}.amazonaws.com`;
    const endpoint = `https://${host}/`;
    const body = JSON.stringify({ Image: { Bytes: imageBase64 }, MaxLabels: 20, MinConfidence: 60 });

    const sign = async (key, msg) => {
      const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)));
    };
    const hex = (buf) => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
    const sha256 = async (msg) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg))));

    const payloadHash = await sha256(body);
    const canonicalHeaders = `content-type:application/x-amz-json-1.1\nhost:${host}\nx-amz-date:${amzDate}\nx-amz-target:RekognitionService.DetectLabels\n`;
    const signedHeaders = 'content-type;host;x-amz-date;x-amz-target';
    const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
    const credentialScope = `${dateStamp}/${REGION}/${service}/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256(canonicalRequest)}`;

    let sigKey = new TextEncoder().encode(`AWS4${SECRET_KEY}`);
    sigKey = await sign(sigKey, dateStamp);
    sigKey = await sign(sigKey, REGION);
    sigKey = await sign(sigKey, service);
    sigKey = await sign(sigKey, 'aws4_request');
    const signature = hex(await sign(sigKey, stringToSign));
    const authorization = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Date': amzDate,
        'X-Amz-Target': 'RekognitionService.DetectLabels',
        'Authorization': authorization,
      },
      body,
    });

    const data = await res.json();
    const detectedLabels = (data.Labels || []).map(l => l.Name);
    const rule = REKOGNITION_LABELS[questId];

    if (!rule || rule.required.length === 0) {
      return { approved: true, message: '自己申告で承認', xpBonus: 0, selfReport: true };
    }

    const matched = rule.required.some(label => detectedLabels.includes(label));
    return {
      approved: matched,
      message: matched ? `${detectedLabels[0]}を検出！` : '条件を満たす物が写っていません',
      xpBonus: matched ? Math.floor(Math.random() * 10) : 0,
      selfReport: false,
    };
  } catch {
    return { approved: false, message: '判定に失敗しました', xpBonus: 0 };
  }
};

// ── QuestCard ──────────────────────────────────────────────
const QuestCard = ({ quest, onComplete, onExpire, userLocation, isChainLocked }) => {
  const [status, setStatus] = useState('idle'); // idle | uploading | approved | rejected | expired
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [judgeResult, setJudgeResult] = useState(null);

  const distance = (quest.type === 'location' && userLocation)
    ? calculateDistance(userLocation.lat, userLocation.lng, quest.lat, quest.lng) : null;
  const isLocationLocked = quest.type === 'location' && (distance === null || distance > quest.radius);

  const rank = RANKS[quest.rank] || RANKS.D;
  const finalXP = Math.round((quest.xp || 20) * rank.xpMult);

  const isSelfReport = SELF_REPORT_QUESTS.has(quest.id);

  const handleSelfReport = () => {
    setJudgeResult({ approved: true, message: '自己申告で承認', xpBonus: 0 });
    setStatus('approved');
    setTimeout(() => onComplete(1), 1200);
  };

  const handleCapture = async (imageBase64) => {
    setIsCameraOpen(false);
    setStatus('uploading');
    const result = await judgePhotoWithRekognition(quest.id, imageBase64);
    setJudgeResult(result);
    if (result.approved) {
      setStatus('approved');
      setTimeout(() => onComplete(finalXP + (result.xpBonus || 0)), 1200);
    } else {
      setStatus('rejected');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  // チェーンロック
  if (isChainLocked) return (
    <div className="border-2 border-dashed border-slate-200 rounded-2xl p-4 mb-3 opacity-50 text-left">
      <div className="flex gap-3 items-center">
        <span className="text-2xl">🔗</span>
        <div>
          <p className="font-bold text-sm text-slate-400">{quest.title}</p>
          <p className="text-[10px] text-slate-400 font-bold">前のクエストを達成すると解放</p>
        </div>
      </div>
    </div>
  );

  // 位置ロック
  if (isLocationLocked) return (
    <div className={`border-2 ${rank.border} rounded-2xl p-4 mb-3 opacity-70 text-left`}>
      <div className="flex gap-3 items-start">
        <div className={`w-10 h-10 rounded-xl ${rank.bg} flex items-center justify-center shrink-0`}>
          <Lock size={18} className={rank.color} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${rank.bg} ${rank.color}`}>{rank.label}ランク</span>
          </div>
          <h3 className="font-bold text-sm text-slate-500">{quest.title}</h3>
          <p className="text-[10px] text-slate-400 font-bold mt-0.5">📍 {userLocation ? formatDistance(distance) : '---'} 先に近づくと解放</p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-black text-sm text-amber-500">+{finalXP}</p>
          <p className="text-[9px] text-slate-400">XP</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className={`border-2 ${rank.border} rounded-2xl p-4 mb-3 text-left transition-all duration-300 shadow-sm ${rank.glow} ${
      status === 'approved' ? 'border-emerald-400 bg-emerald-50' :
      status === 'rejected' ? 'border-red-300 bg-red-50' :
      status === 'expired'  ? 'border-slate-200 bg-slate-50 opacity-50' :
      quest.isUrgent        ? 'bg-gradient-to-br from-orange-50 to-red-50' : rank.bg
    }`}>
      <CameraOverlay isOpen={isCameraOpen} onClose={() => setIsCameraOpen(false)} onCapture={handleCapture} />

      <div className="flex gap-3 items-start mb-3">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-2xl shrink-0 bg-white shadow-sm border ${rank.border}`}>
          {quest.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${rank.bg} ${rank.color} border ${rank.border}`}>{rank.label}ランク</span>
            {quest.isAI && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600">🤖 AI生成</span>}
            {quest.isUrgent && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 animate-pulse">🚨 緊急</span>}
            {quest.chainNext && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600">🔗 連鎖</span>}
          </div>
          <h3 className="font-bold text-base text-slate-800">{quest.title}</h3>
          {quest.description && <p className="text-xs text-slate-500 font-bold mt-0.5">{quest.description}</p>}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs font-black text-amber-500">⚡+{finalXP} XP</span>
            {rank.xpMult > 1 && <span className="text-[9px] text-slate-400 font-bold">({rank.xpMult}x倍率)</span>}
            <span className="text-[10px] text-slate-400 font-bold">{quest.category}</span>
          </div>
        </div>
        <div className="shrink-0">
          {quest.isUrgent && quest.deadlineTs && status === 'idle' &&
            <CountdownTimer deadlineTs={quest.deadlineTs} onExpire={() => { setStatus('expired'); onExpire?.(quest.id); }} />
          }
        </div>
      </div>

      {/* AI判定結果 */}
      {judgeResult && (status === 'approved' || status === 'rejected') && (
        <div className={`mb-3 p-3 rounded-xl text-xs font-bold flex items-center gap-2 ${status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
          <span>{status === 'approved' ? '✅' : '❌'}</span>
          <span>{judgeResult.message}</span>
          {status === 'approved' && judgeResult.xpBonus > 0 && <span className="ml-auto font-black text-emerald-600">+{judgeResult.xpBonus} ボーナス!</span>}
        </div>
      )}

      {status === 'idle' && (() => {
        const hint = REKOGNITION_LABELS[quest.id]?.hint;
        return hint ? (
          <p className="text-xs text-slate-400 font-bold text-center mb-2 bg-slate-50 rounded-xl px-3 py-2">📷 {hint}</p>
        ) : null;
      })()}
      {status === 'idle' && isSelfReport && <button type="button" onClick={handleSelfReport} className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-all text-sm shadow-sm ${quest.isUrgent ? 'bg-red-500 text-white' : 'bg-slate-900 text-white'}`}><CheckCircle2 size={16} />完了する</button>}
      {status === 'idle' && !isSelfReport && <button type="button" onClick={() => setIsCameraOpen(true)} className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-all text-sm shadow-sm ${quest.isUrgent ? 'bg-red-500 text-white' : 'bg-slate-900 text-white'}`}><Camera size={16} />カメラで証明</button>}
      {status === 'uploading' && <div className="w-full py-3 bg-indigo-50 text-indigo-600 rounded-xl font-bold flex items-center justify-center gap-2 text-sm"><Loader2 className="animate-spin" size={16} />AI判定中...</div>}
      {status === 'approved' && <div className="w-full py-3 bg-emerald-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-md text-sm"><CheckCircle2 size={16} />達成認定！</div>}
      {status === 'rejected' && <div className="w-full py-3 bg-red-100 text-red-600 rounded-xl font-bold flex items-center justify-center gap-2 text-sm"><X size={16} />未達成 — 再挑戦できます</div>}
      {status === 'expired' && <div className="w-full py-3 bg-slate-100 text-slate-400 rounded-xl font-bold flex items-center justify-center gap-2 text-sm">⏰ 時間切れ</div>}
    </div>
  );
};

// ── Admin ──────────────────────────────────────────────────
const ADMIN_EMAIL = 'tataka1507@gmail.com';
const NOTIFY_API_URL = import.meta.env.VITE_NOTIFY_API_URL || '';

const AdminTab = ({ currentUser, db, appId, allUsers, onUserDeleted }) => {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [title, setTitle] = useState('⚡ クエスト到着！');
  const [body, setBody] = useState('新しいクエストが届いた！5分以内にクリアせよ！');
  const [deletingUserId, setDeletingUserId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [deleteResult, setDeleteResult] = useState(null);

  const sendNotification = async () => {
    if (!NOTIFY_API_URL) { setResult({ ok: false, msg: 'API URLが未設定です' }); return; }
    setSending(true); setResult(null);
    try {
      const res = await fetch(NOTIFY_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, force: true }),
      });
      const data = await res.json();
      setResult({ ok: res.ok, msg: res.ok ? `✅ ${data.sent}人に送信完了！` : `❌ ${JSON.stringify(data)}` });
    } catch (e) {
      setResult({ ok: false, msg: `❌ ${e.message}` });
    } finally { setSending(false); }
  };

  const handleDeleteUser = async (userId) => {
    if (!db || !appId) return;
    setDeletingUserId(userId);
    setDeleteResult(null);
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', userId));
      setDeleteResult({ ok: true, msg: '✅ ユーザーを削除しました' });
      onUserDeleted?.(userId);
    } catch (e) {
      setDeleteResult({ ok: false, msg: `❌ 削除失敗: ${e.message}` });
    } finally {
      setDeletingUserId(null);
      setConfirmDeleteId(null);
      setTimeout(() => setDeleteResult(null), 3000);
    }
  };

  const filteredUsers = userSearchQuery.trim()
    ? allUsers.filter(u =>
        u.name?.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
        u.email?.toLowerCase().includes(userSearchQuery.toLowerCase())
      )
    : allUsers;

  const sortedUsers = [...filteredUsers].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return (
    <div className="px-4 py-6 space-y-4">
      <div className="bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl p-4 text-white">
        <p className="font-black text-lg">🛡️ 管理者パネル</p>
        <p className="text-red-100 text-xs">{currentUser.email}</p>
      </div>

      {/* 通知送信 */}
      <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
        <p className="font-black text-slate-700">📣 全ユーザーに通知を送信</p>
        <div>
          <label className="text-xs font-bold text-slate-500 block mb-1">タイトル</label>
          <input className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold focus:outline-none focus:border-indigo-400" value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-500 block mb-1">メッセージ</label>
          <textarea className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold focus:outline-none focus:border-indigo-400 resize-none" rows={3} value={body} onChange={e => setBody(e.target.value)} />
        </div>
        <button onClick={sendNotification} disabled={sending} className="w-full bg-gradient-to-r from-red-500 to-orange-500 text-white font-black py-3 rounded-xl disabled:opacity-50 active:scale-95 transition-transform">
          {sending ? '送信中...' : '🚀 今すぐ全員に通知'}
        </button>
        {result && (
          <div className={`text-sm font-bold p-3 rounded-xl ${result.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{result.msg}</div>
        )}
      </div>

      {/* ユーザー管理 */}
      <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-black text-slate-700">👥 ユーザー管理</p>
          <span className="text-xs font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{allUsers.length}人</span>
        </div>

        {/* 検索 */}
        <div className="relative">
          <input
            type="text"
            placeholder="名前・メールで検索..."
            value={userSearchQuery}
            onChange={e => setUserSearchQuery(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold focus:outline-none focus:border-indigo-400 pr-8"
          />
          {userSearchQuery && (
            <button type="button" onClick={() => setUserSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300">
              <X size={14} />
            </button>
          )}
        </div>

        {deleteResult && (
          <div className={`text-sm font-bold p-3 rounded-xl ${deleteResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{deleteResult.msg}</div>
        )}

        <div className="space-y-2 max-h-80 overflow-y-auto">
          {sortedUsers.length === 0 && (
            <p className="text-center text-sm text-slate-400 font-bold py-4">ユーザーが見つかりません</p>
          )}
          {sortedUsers.map(user => {
            const isMe = user.id === currentUser.id;
            const isConfirming = confirmDeleteId === user.id;
            const isDeleting = deletingUserId === user.id;
            return (
              <div key={user.id} className={`flex items-center gap-3 p-3 rounded-xl border ${isMe ? 'bg-indigo-50 border-indigo-100' : 'bg-slate-50 border-slate-100'}`}>
                <img
                  src={user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.name}`}
                  className="w-9 h-9 rounded-xl flex-shrink-0"
                  alt=""
                />
                <div className="flex-1 min-w-0 text-left">
                  <p className="font-black text-sm text-slate-800 truncate">
                    {user.name}{isMe ? ' (あなた)' : ''}
                  </p>
                  <p className="text-[10px] text-slate-400 font-bold truncate">{user.email}</p>
                  <p className="text-[10px] text-slate-400 font-bold">Lv.{user.level || 1} · {user.totalXP || 0} XP</p>
                </div>
                {!isMe && (
                  isConfirming ? (
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleDeleteUser(user.id)}
                        disabled={isDeleting}
                        className="px-2 py-1.5 bg-red-500 text-white rounded-lg text-xs font-black active:scale-90 transition-transform disabled:opacity-50 flex items-center gap-1"
                      >
                        {isDeleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                        確認
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2 py-1.5 bg-slate-200 text-slate-600 rounded-lg text-xs font-black active:scale-90 transition-transform"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(user.id)}
                      className="p-2 rounded-xl bg-red-50 text-red-400 active:scale-90 transition-transform flex-shrink-0 hover:bg-red-100"
                    >
                      <Trash2 size={15} />
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ── Main App ───────────────────────────────────────────────
export default function App() {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [currentUser, setCurrentUser] = useState(() => { try { const s = localStorage.getItem(SESSION_KEY); return s ? JSON.parse(s) : null; } catch { return null; } });
  const [allUsers, setAllUsers] = useState([]);
  const [activeTab, setActiveTab] = useState('home');
  const [notification, setNotification] = useState(null); // { type: 'levelup'|'badge', data }
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  const { location: userLocation, gpsStatus, mockOffset, setMockOffset, retryGPS, QUEST_LAT, QUEST_LNG } = useGeolocation();

  const [schedule, setSchedule] = useState(() => getOrBuildSchedule());
  const COMPLETED_KEY = 'lifequest_completed_v1';
  const [completedIds, setCompletedIds] = useState(() => {
    try {
      const saved = localStorage.getItem('lifequest_completed_v1');
      if (saved) {
        const { dateKey, ids } = JSON.parse(saved);
        if (dateKey === new Date().toDateString()) return ids;
      }
    } catch {}
    return [];
  });
  const [quests, setQuests] = useState(() => getActiveQuests(getOrBuildSchedule(), []));

  const completedIdsRef = useRef([]);
  const forceShowNextQuestRef = useRef(null);
  useEffect(() => { completedIdsRef.current = completedIds; }, [completedIds]);

  const scheduleRef = useRef(schedule);
  // scheduleが変わったら常にquestsを更新
  useEffect(() => {
    scheduleRef.current = schedule;
    setQuests(getActiveQuests(schedule, completedIdsRef.current));
  }, [schedule]);

  // 毎2秒: クエスト表示更新 & SWからのフラグ監視 & 日付リセット
  useEffect(() => {
    const tick = async () => {
      const todayKey = new Date().toDateString();
      let sched = scheduleRef.current;
      // 日付変わったらスケジュール再生成
      try {
        const saved = localStorage.getItem(DAILY_QUEST_KEY);
        if (saved) {
          const { dateKey } = JSON.parse(saved);
          if (dateKey !== todayKey) {
            sched = buildDailySchedule();
            localStorage.setItem(DAILY_QUEST_KEY, JSON.stringify({ dateKey: todayKey, schedule: sched }));
            setSchedule(sched);
            setCompletedIds([]);
          }
        }
      } catch {}
      // SWからのforceフラグを監視（localStorage）
      try {
        const flag = localStorage.getItem('lifequest_force_quest');
        if (flag) {
          localStorage.removeItem('lifequest_force_quest');
          forceShowNextQuestRef.current?.();
          return;
        }
      } catch {}
      // Firestoreのforceフラグを監視（PWA対応）
      try {
        const flagDoc = await getDoc(doc(db, 'artifacts', appId, 'public', 'data'));
        if (flagDoc.exists() && flagDoc.data()?.forceQuest === true) {
          await updateDoc(doc(db, 'artifacts', appId, 'public', 'data'), { forceQuest: false });
          forceShowNextQuestRef.current?.();
          return;
        }
      } catch {}
      setQuests(getActiveQuests(sched, completedIdsRef.current));
    };
    tick();
    const interval = setInterval(tick, 2000);
    return () => clearInterval(interval);
  }, []); // 依存配列を空にしてintervalを一度だけ生成

  // クエストを強制的に表示する（未完了のうち1個だけ追加アクティブ化・タイマーリセット）
  const forceShowNextQuest = useCallback(() => {
    setSchedule(prev => {
      const now = Date.now();
      const QUEST_DURATION = 5 * 60 * 1000;
      let addedOne = false;
      const updated = prev.map(q => {
        if (completedIdsRef.current.includes(q.id)) return q;
        const isActive = q.deliverAt <= now && q.deadlineTs > now;
        if (isActive) {
          return { ...q, deadlineTs: now + QUEST_DURATION };
        }
        if (!addedOne) {
          addedOne = true;
          return { ...q, deliverAt: now - 1000, deadlineTs: now + QUEST_DURATION };
        }
        return q;
      });
      try { localStorage.setItem(DAILY_QUEST_KEY, JSON.stringify({ dateKey: new Date().toDateString(), schedule: updated })); } catch {}
      return updated;
    });
  }, []);
  forceShowNextQuestRef.current = forceShowNextQuest;

  // フォアグラウンド通知受信 → クエスト更新 + 手動バナー表示
  useEffect(() => {
    const unsub = onMessage(messaging, (payload) => {
      forceShowNextQuest();
      const { title, body } = payload.notification || {};
      if (Notification.permission === 'granted') {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(title || '⚡ クエスト到着！', {
            body: body || '新しいクエストが届いた！5分以内にクリアせよ！',
            icon: '/icon-192.png',
            tag: 'lifequest-quest',
            renotify: true,
            requireInteraction: true,
          });
        });
      }
    });
    return unsub;
  }, [forceShowNextQuest]);

  // Service Workerからのメッセージ受信（通知タップ時）
  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type === 'FORCE_QUEST' || event.data?.type === 'FORCE_QUEST_ALL') {
        // localStorageにフラグを立てる → ポーリングが2秒以内に検知してforceShowNextQuestを呼ぶ
        try { localStorage.setItem('lifequest_force_quest', '1'); } catch {}
        forceShowNextQuest();
      }
    };
    navigator.serviceWorker?.addEventListener('message', handler);
    return () => navigator.serviceWorker?.removeEventListener('message', handler);
  }, [forceShowNextQuest]);


  useEffect(() => {
    const init = async () => {
      try {
        await signInAnonymously(auth);
      } catch (e) { console.error(e); }
    };
    init();
    return onAuthStateChanged(auth, u => setFirebaseUser(u));
  }, []);

  // 全ユーザー取得（ランキング用）
  useEffect(() => {
    if (!currentUser) return;
    const col = collection(db, 'artifacts', appId, 'public', 'data', 'users');
    const unsub = onSnapshot(col, snap => {
      setAllUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [currentUser?.id]);

  // アプリ起動のたびにFCMトークンを更新（トークン期限切れ対策）
  useEffect(() => {
    if (currentUser?.id) {
      registerPushToken(currentUser.id);
    }
  }, [currentUser?.id]);

  const showNotification = (type, data) => {
    setNotification({ type, data });
    setTimeout(() => setNotification(null), 3500);
  };

  const saveUser = useCallback(async (updated) => {
    setCurrentUser(updated);
    localStorage.setItem(SESSION_KEY, JSON.stringify(updated));
    try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', updated.id), updated); } catch {}
  }, []);

  const handleQuestComplete = async (questId, reward, questMeta = {}) => {
    if (!currentUser) return;
    let newXp = (currentUser.xp || 0) + reward;
    let newLevel = currentUser.level || 1;
    const maxXP = newLevel * 200;
    let leveledUp = false;
    if (newXp >= maxXP) { newXp -= maxXP; newLevel++; leveledUp = true; }

    const updated = {
      ...currentUser, xp: newXp, level: newLevel,
      totalXP: (currentUser.totalXP || 0) + reward,
      totalCompleted: (currentUser.totalCompleted || 0) + 1,
      locationCompleted: questMeta.isLocation ? (currentUser.locationCompleted || 0) + 1 : (currentUser.locationCompleted || 0),
      aiCompleted: questMeta.isAI ? (currentUser.aiCompleted || 0) + 1 : (currentUser.aiCompleted || 0),
    };

    const newBadgeIds = checkNewBadges(updated);
    if (newBadgeIds.length > 0) {
      updated.badges = [...(updated.badges || []), ...newBadgeIds];
      const badge = BADGES.find(b => b.id === newBadgeIds[0]);
      showNotification('badge', badge);
    } else if (leveledUp) {
      showNotification('levelup', { level: newLevel });
    } else {
      showNotification('xp', { xp: reward });
    }

    await saveUser(updated);
    setCompletedIds(prev => {
      const next = [...prev, questId];
      try {
        localStorage.setItem(COMPLETED_KEY, JSON.stringify({ dateKey: new Date().toDateString(), ids: next }));
      } catch {}
      return next;
    });
  };

  const handleLoginSuccess = user => {
    setCurrentUser(user);
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    registerPushToken(user.id);
    // 通知タップ起動時のフラグを確認 → ログイン完了後にクエスト追加
    try {
      const flag = localStorage.getItem('lifequest_force_quest');
      if (flag) {
        localStorage.removeItem('lifequest_force_quest');
        setTimeout(() => forceShowNextQuestRef.current?.(), 500);
      }
    } catch {}
  };
  const handleLogout = () => { setCurrentUser(null); localStorage.removeItem(SESSION_KEY); setActiveTab('home'); };

  if (!currentUser) return (
    <div className="max-w-md mx-auto h-screen bg-white shadow-2xl overflow-hidden flex flex-col">
      <AuthGateway onLoginSuccess={handleLoginSuccess} isFirebaseReady={!!firebaseUser} />
    </div>
  );

  const gpsLabel = { loading: 'GPS取得中', ok: 'GPS接続中', mock: 'デモモード' }[gpsStatus] || 'GPS';
  const gpsColor = { loading: 'bg-amber-100 text-amber-600', ok: 'bg-emerald-100 text-emerald-600', mock: 'bg-violet-100 text-violet-600' }[gpsStatus] || '';
  const maxXP = (currentUser.level || 1) * 200;

  const isAdmin = currentUser.email === ADMIN_EMAIL;
  const tabs = [
    { key: 'home',   icon: <Home size={20} />,    label: 'ホーム' },
    { key: 'map',    icon: <Map size={20} />,      label: 'マップ' },
    { key: null },
    { key: 'social', icon: <Users size={20} />,    label: 'ソーシャル' },
    { key: 'badges', icon: <Award size={20} />,    label: 'バッジ' },
  ];

  return (
    <div className="max-w-md mx-auto h-screen bg-slate-50 flex flex-col font-sans text-slate-900 shadow-2xl relative overflow-hidden">

      {/* Notification */}
      {notification && (
        <div className="absolute top-4 left-4 right-4 z-[300] animate-bounce">
          {notification.type === 'levelup' && (
            <div className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-2xl p-4 shadow-2xl flex items-center gap-3">
              <Trophy size={28} className="text-yellow-300" />
              <div><p className="font-black text-sm">レベルアップ！🎉</p><p className="text-indigo-200 text-xs">レベル {notification.data.level} に到達！</p></div>
            </div>
          )}
          {notification.type === 'badge' && (
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-2xl p-4 shadow-2xl flex items-center gap-3">
              <span className="text-3xl">{notification.data?.icon}</span>
              <div><p className="font-black text-sm">バッジ獲得！🏅</p><p className="text-amber-100 text-xs">「{notification.data?.name}」を解除！</p></div>
            </div>
          )}
          {notification.type === 'xp' && (
            <div className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-2xl p-4 shadow-2xl flex items-center gap-3">
              <Zap size={24} className="text-yellow-300" />
              <div><p className="font-black text-sm">クエスト達成！⚡</p><p className="text-emerald-100 text-xs">+{notification.data?.xp} XP 獲得！</p></div>
            </div>
          )}
        </div>
      )}

      {/* Main */}
      <main className={`flex-1 overflow-y-auto ${activeTab === 'map' ? '' : 'pb-24'}`}>
        {activeTab === 'home' && (
          <div className="px-4 py-4">
            {/* ランク凡例 */}
            <div className="flex gap-1.5 mb-3 flex-wrap">
              {Object.entries(RANKS).map(([k, r]) => (
                <span key={k} className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${r.bg} ${r.color} ${r.border}`}>{k} ×{r.xpMult}</span>
              ))}
            </div>
            <h3 className="font-black text-base text-slate-700 tracking-tight mb-3 text-left uppercase">本日のクエスト</h3>
            {quests.length > 0
              ? quests.map(q => {
                  const prevQuest = quests.find(pq => pq.chainNext === q.id);
                  const isChainLocked = !!prevQuest && !completedIds.includes(prevQuest.id);
                  return (
                    <QuestCard
                      key={q.id}
                      quest={q}
                      onComplete={(xp) => handleQuestComplete(q.id, xp, { isLocation: q.type === 'location', isAI: q.isAI })}
                      onExpire={(id) => setCompletedIds(prev => [...prev, id])}
                      userLocation={userLocation}
                      isChainLocked={isChainLocked}
                    />
                  );
                })
              : (() => {
                  const allDone = schedule.every(q => completedIds.includes(q.id));
                  return (
                    <div className="text-center py-12 bg-white rounded-3xl border-2 border-dashed border-slate-200">
                      {allDone
                        ? <><CheckCircle2 size={32} className="text-emerald-400 mx-auto mb-2" /><p className="font-bold text-slate-400">本日の全クエスト完了！🎉</p></>
                        : <><span className="text-3xl block mb-2">⏳</span><p className="font-bold text-slate-500">次のクエストを待て...</p></>
                      }
                    </div>
                  );
                })()
            }
          </div>
        )}
        {activeTab === 'map' && (
          <div className="absolute inset-0 w-full h-full z-0">
            <MapTab
              quests={quests}
              userLocation={userLocation}
              gpsStatus={gpsStatus}
              mockOffset={mockOffset}
              setMockOffset={setMockOffset}
              QUEST_LAT={QUEST_LAT}
              QUEST_LNG={QUEST_LNG}
              currentUser={currentUser}
              db={db}
              appId={appId}
              modelPath={currentUser?.modelPath || '/model.vrm'}
              onQuestComplete={(poi) => {
                handleQuestComplete('poi_' + poi.poiType, poi.xp, { isLocation: true });
              }}
            />
          </div>
        )}
        {/* ← db, appId を追加 */}
        {activeTab === 'social' && <SocialTab currentUser={currentUser} allUsers={allUsers} onUpdateUser={saveUser} db={db} appId={appId} />}
        {activeTab === 'badges' && <BadgesTab currentUser={currentUser} maxXP={maxXP} handleLogout={handleLogout} onEditProfile={() => setIsEditingProfile(true)} />}
        {activeTab === 'admin' && isAdmin && <AdminTab currentUser={currentUser} db={db} appId={appId} allUsers={allUsers} onUserDeleted={(id) => setAllUsers(prev => prev.filter(u => u.id !== id))} />}
      </main>

      {isEditingProfile && (
        <ProfileEditModal
          currentUser={currentUser}
          onSave={saveUser}
          onClose={() => setIsEditingProfile(false)}
          db={db}
          appId={appId}
        />
      )}

      {/* Nav */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white/95 backdrop-blur-lg border-t border-slate-100 flex justify-around items-center px-2 py-2 z-40">
        {tabs.map((item, i) => {
          if (i === 2) return (
            <div key="fab" className="relative -top-5">
              <button type="button" onClick={() => setActiveTab('home')} className={`w-14 h-14 rounded-full text-white flex items-center justify-center shadow-xl border-4 border-white active:scale-90 transition-transform bg-gradient-to-br from-indigo-500 to-violet-600`}>
                <Sparkles size={24} />
              </button>
            </div>
          );
          return (
            <button key={item.key} type="button" onClick={() => setActiveTab(item.key)} className={`flex flex-col items-center gap-0.5 p-2 transition-colors ${activeTab === item.key ? 'text-indigo-600' : 'text-slate-400'}`}>
              {item.icon}
              <span className="text-[9px] font-black uppercase tracking-tight">{item.label}</span>
            </button>
          );
        })}
        {isAdmin && (
          <button type="button" onClick={() => setActiveTab('admin')} className={`flex flex-col items-center gap-0.5 p-2 transition-colors ${activeTab === 'admin' ? 'text-red-500' : 'text-slate-400'}`}>
            <span className="text-xl">🛡️</span>
            <span className="text-[9px] font-black uppercase tracking-tight">管理</span>
          </button>
        )}
      </nav>
    </div>
  );
}
