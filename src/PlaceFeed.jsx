// ── PlaceFeed.jsx ─────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot, deleteDoc, doc } from 'firebase/firestore';
import { Loader2, Trash2, X, ChevronRight } from 'lucide-react';

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

// ── 場所詳細モーダル ──────────────────────────────────────────
const PlaceModal = ({ group, currentUserId, onDelete, deleting, onClose }) => {
  const info = POI_LABELS[group.poiType] ?? POI_LABELS.mall;
  return (
    <div
      className="fixed inset-0 z-[400] flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-white rounded-t-3xl overflow-hidden" style={{ maxHeight: '85vh' }}>
        <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-100">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
            style={{ background: info.color + '22' }}
          >
            {info.emoji}
          </div>
          <div className="flex-1 text-left">
            <p className="font-black text-base text-slate-800">{group.poiName}</p>
            <p className="text-xs text-slate-400 font-bold">📷 {group.posts.length}枚の写真</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full bg-slate-100 text-slate-400 active:scale-90 transition-transform"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto" style={{ maxHeight: 'calc(85vh - 72px)' }}>
          {group.posts.map(post => {
            const isMe = post.userId === currentUserId;
            return (
              <div key={post.id} className="border-b border-slate-50 last:border-0">
                <div className="flex items-center gap-3 px-4 pt-3 pb-2">
                  <img
                    src={post.userAvatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.userName}`}
                    className="w-8 h-8 rounded-xl border border-slate-100"
                    alt=""
                  />
                  <div className="flex-1 text-left">
                    <p className="font-black text-sm text-slate-800">
                      {post.userName}{isMe ? ' (あなた)' : ''}
                    </p>
                    <p className="text-[10px] text-slate-400 font-bold">{timeAgo(post.createdAt)}</p>
                  </div>
                  {isMe && (
                    <button
                      type="button"
                      onClick={() => onDelete(post.id)}
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
                <div className="w-full" style={{ aspectRatio: '1' }}>
                  <img
                    src={`data:image/jpeg;base64,${post.imageBase64}`}
                    className="w-full h-full object-cover"
                    alt={post.poiName}
                  />
                </div>
                {post.caption
                  ? <p className="px-4 py-3 text-sm text-slate-700 font-bold text-left">{post.caption}</p>
                  : <div className="pb-2" />
                }
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ── PlaceFeed ─────────────────────────────────────────────────
const PlaceFeed = ({ db, appId, currentUserId }) => {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const [openGroup, setOpenGroup] = useState(null);

  useEffect(() => {
    if (!db || !appId) return;
    const col = collection(db, 'artifacts', appId, 'public', 'data', 'poi_photos');
    const q = query(col, orderBy('createdAt', 'desc'), limit(100));
    const unsub = onSnapshot(q, (snap) => {
      setPosts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [db, appId]);

  const handleDelete = async (postId) => {
    setDeleting(postId);
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'poi_photos', postId));
    } catch (e) {
      console.warn('[PlaceFeed] 削除失敗:', e);
    }
    setDeleting(null);
  };

  const groups = posts.reduce((acc, post) => {
    const key = post.poiName || post.poiType;
    if (!acc[key]) {
      acc[key] = { poiName: post.poiName || key, poiType: post.poiType, posts: [], latestAt: 0 };
    }
    acc[key].posts.push(post);
    if (post.createdAt > acc[key].latestAt) acc[key].latestAt = post.createdAt;
    return acc;
  }, {});
  const sortedGroups = Object.values(groups).sort((a, b) => b.latestAt - a.latestAt);

  const syncedOpenGroup = openGroup
    ? sortedGroups.find(g => g.poiName === openGroup.poiName) ?? null
    : null;

  if (loading) return (
    <div className="flex items-center justify-center py-12 text-slate-400">
      <Loader2 size={20} className="animate-spin mr-2" />読み込み中...
    </div>
  );

  if (sortedGroups.length === 0) return (
    <div className="text-center py-12 bg-white rounded-3xl border-2 border-dashed border-slate-200">
      <span className="text-3xl block mb-2">📷</span>
      <p className="font-bold text-slate-400 text-sm">まだ投稿がありません</p>
      <p className="text-xs text-slate-300 mt-1">マップのピンをタップして写真を投稿しよう</p>
    </div>
  );

  return (
    <>
      <div className="space-y-3">
        {sortedGroups.map(group => {
          const info = POI_LABELS[group.poiType] ?? POI_LABELS.mall;
          const previews = group.posts.slice(0, 3);
          return (
            <button
              key={group.poiName}
              type="button"
              onClick={() => setOpenGroup(group)}
              className="w-full bg-white rounded-3xl overflow-hidden border border-slate-100 shadow-sm active:scale-[0.98] transition-transform text-left"
            >
              <div className="flex items-center gap-3 px-4 pt-4 pb-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                  style={{ background: info.color + '22' }}
                >
                  {info.emoji}
                </div>
                <div className="flex-1">
                  <p className="font-black text-sm text-slate-800">{group.poiName}</p>
                  <p className="text-[10px] text-slate-400 font-bold">
                    📷 {group.posts.length}枚 · {timeAgo(group.latestAt)}
                  </p>
                </div>
                <ChevronRight size={16} className="text-slate-300" />
              </div>

              <div className="flex gap-1 px-4 pb-4">
                {previews.map((post, i) => (
                  <div key={post.id} className="flex-1 relative" style={{ aspectRatio: '1' }}>
                    <img
                      src={`data:image/jpeg;base64,${post.imageBase64}`}
                      className="w-full h-full object-cover rounded-xl"
                      alt=""
                    />
                    {i === 2 && group.posts.length > 3 && (
                      <div className="absolute inset-0 bg-black/50 rounded-xl flex items-center justify-center">
                        <span className="text-white font-black text-sm">+{group.posts.length - 3}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {syncedOpenGroup && (
        <PlaceModal
          group={syncedOpenGroup}
          currentUserId={currentUserId}
          onDelete={handleDelete}
          deleting={deleting}
          onClose={() => setOpenGroup(null)}
        />
      )}
    </>
  );
};

export default PlaceFeed;
