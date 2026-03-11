// ── PlaceFeed.jsx ─────────────────────────────────────────────
// ソーシャルタブに追加するフィード（タイムライン）コンポーネント
// App.jsx の SocialTab 内でインポートして使う

import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, orderBy, limit, onSnapshot, deleteDoc, doc } from 'firebase/firestore';
import { MapPin, Loader2, Trash2 } from 'lucide-react';

const POI_LABELS = {
  park:        { label: '公園',              emoji: '🌳', color: '#5a9e6f' },
  garden:      { label: 'ガーデン',          emoji: '🌸', color: '#5a9e6f' },
  mall:        { label: 'ショッピングモール', emoji: '🏬', color: '#e8734a' },
  supermarket: { label: 'スーパー',          emoji: '🛒', color: '#e8734a' },
  school:      { label: '学校',              emoji: '🏫', color: '#6a9bd4' },
  hospital:    { label: '病院',              emoji: '🏥', color: '#e85a5a' },
};

const timeAgo = (ts) => {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'たった今';
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
};

const PlaceFeed = ({ db, appId, currentUserId }) => {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);

  const handleDelete = async (postId) => {
    setDeleting(postId);
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'poi_photos', postId));
    } catch (e) {
      console.warn('[PlaceFeed] 削除失敗:', e);
    }
    setDeleting(null);
  };

  useEffect(() => {
    if (!db || !appId) return;
    const col = collection(db, 'artifacts', appId, 'public', 'data', 'poi_photos');
    const q = query(col, orderBy('createdAt', 'desc'), limit(30));
    const unsub = onSnapshot(q, (snap) => {
      setPosts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [db, appId]);

  if (loading) return (
    <div className="flex items-center justify-center py-12 text-slate-400">
      <Loader2 size={20} className="animate-spin mr-2" />読み込み中...
    </div>
  );

  if (posts.length === 0) return (
    <div className="text-center py-12 bg-white rounded-3xl border-2 border-dashed border-slate-200 mx-4">
      <span className="text-3xl block mb-2">📷</span>
      <p className="font-bold text-slate-400 text-sm">まだ投稿がありません</p>
      <p className="text-xs text-slate-300 mt-1">マップのピンをタップして写真を投稿しよう</p>
    </div>
  );

  return (
    <div className="space-y-4 px-4">
      {posts.map(post => {
        const info = POI_LABELS[post.poiType] ?? POI_LABELS.mall;
        const isMe = post.userId === currentUserId;
        return (
          <div key={post.id} className="bg-white rounded-3xl overflow-hidden border border-slate-100 shadow-sm">
            {/* ユーザー行 */}
            <div className="flex items-center gap-3 px-4 pt-4 pb-2">
              <img
                src={post.userAvatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.userName}`}
                className="w-9 h-9 rounded-xl border border-slate-100"
                alt=""
              />
              <div className="flex-1 text-left">
                <p className="font-black text-sm text-slate-800">
                  {post.userName}{isMe ? ' (あなた)' : ''}
                </p>
                <div className="flex items-center gap-1 text-[10px] text-slate-400 font-bold">
                  <MapPin size={10} />
                  <span
                    className="px-1.5 py-0.5 rounded-full font-black"
                    style={{ background: info.color + '22', color: info.color }}
                  >
                    {info.emoji} {post.poiName}
                  </span>
                  <span>· {timeAgo(post.createdAt)}</span>
                </div>
              </div>
              {isMe && (
                <button
                  type="button"
                  onClick={() => handleDelete(post.id)}
                  disabled={deleting === post.id}
                  className="p-2 rounded-xl bg-slate-50 text-slate-400 active:scale-90 transition-transform disabled:opacity-40"
                >
                  {deleting === post.id
                    ? <Loader2 size={15} className="animate-spin" />
                    : <Trash2 size={15} />
                  }
                </button>
              )}
            </div>

            {/* 写真 */}
            <img
              src={`data:image/jpeg;base64,${post.imageBase64}`}
              className="w-full object-cover"
              style={{ maxHeight: 280 }}
              alt={post.poiName}
            />

            {/* キャプション */}
            {post.caption && (
              <div className="px-4 py-3 text-left">
                <p className="text-sm text-slate-700 font-bold">{post.caption}</p>
              </div>
            )}
            {!post.caption && <div className="pb-2" />}
          </div>
        );
      })}
    </div>
  );
};

export default PlaceFeed;
