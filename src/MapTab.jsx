import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Navigation, Zap } from 'lucide-react';

// ── ユーティリティ ────────────────────────────────────────
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

// ── ランクカラー ──────────────────────────────────────────
const RANK_COLORS = {
  S: { glow: '#f59e0b', bg: '#fef3c7', icon: '👑' },
  A: { glow: '#8b5cf6', bg: '#ede9fe', icon: '⚡' },
  B: { glow: '#3b82f6', bg: '#dbeafe', icon: '🔵' },
  C: { glow: '#10b981', bg: '#d1fae5', icon: '🟢' },
  D: { glow: '#6b7280', bg: '#f3f4f6', icon: '⚪' },
};

// ── MapTab コンポーネント ──────────────────────────────────
const MapTab = ({ quests, userLocation, gpsStatus, mockOffset, setMockOffset, QUEST_LAT, QUEST_LNG }) => {
  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef([]);
  const playerMarkerRef = useRef(null);
  const pulseIntervalRef = useRef(null);
  const [selectedQuest, setSelectedQuest] = useState(null);
  const [mapReady, setMapReady] = useState(false);

  const locationQuests = quests.filter(q => q.type === 'location');

  // Leaflet初期化
  useEffect(() => {
    if (leafletMap.current) return;

    const loadLeaflet = () => {
      if (!mapRef.current) return;
      const L = window.L;

      const map = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false,
        minZoom: 13,
        maxZoom: 19,
      }).setView([QUEST_LAT, QUEST_LNG], 16);

      // ポケモンGO風の明るいマップタイル
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
      }).addTo(map);

      L.control.zoom({ position: 'bottomright' }).addTo(map);
      leafletMap.current = map;
      setMapReady(true);
    };

    if (window.L) {
      loadLeaflet();
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const style = document.createElement('style');
    style.textContent = `
      .leaflet-container { background: #e8f4f8; font-family: 'Nunito', sans-serif; }
      .quest-popup .leaflet-popup-content-wrapper {
        background: rgba(255,255,255,0.95);
        backdrop-filter: blur(12px);
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.15);
        border: none;
        padding: 0;
      }
      .quest-popup .leaflet-popup-tip { background: rgba(255,255,255,0.95); }
      .quest-popup .leaflet-popup-content { margin: 0; }
      @keyframes questPulse {
        0% { transform: scale(1); opacity: 0.8; }
        50% { transform: scale(1.5); opacity: 0; }
        100% { transform: scale(1); opacity: 0; }
      }
      @keyframes playerFloat {
        0%, 100% { transform: translateY(0px); }
        50% { transform: translateY(-4px); }
      }
      @keyframes radarSweep {
        0% { transform: scale(0.5); opacity: 0.6; }
        100% { transform: scale(3); opacity: 0; }
      }
    `;
    document.head.appendChild(style);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = loadLeaflet;
    document.head.appendChild(script);

    return () => {
      if (pulseIntervalRef.current) clearInterval(pulseIntervalRef.current);
    };
  }, []);

  // マーカー更新
  useEffect(() => {
    if (!leafletMap.current || !window.L || !mapReady) return;
    const L = window.L;

    // 既存マーカーを削除
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    if (playerMarkerRef.current) playerMarkerRef.current.remove();

    // プレイヤーキャラクター
    if (userLocation) {
      const playerHtml = `
        <div style="position:relative;width:48px;height:48px">
          <!-- レーダー波紋 -->
          <div style="position:absolute;inset:-8px;border-radius:50%;border:2px solid #6366f1;animation:radarSweep 2s infinite"></div>
          <div style="position:absolute;inset:-8px;border-radius:50%;border:2px solid #6366f1;animation:radarSweep 2s 1s infinite"></div>
          <!-- シャドウ -->
          <div style="position:absolute;bottom:-4px;left:50%;transform:translateX(-50%);width:24px;height:8px;background:rgba(0,0,0,0.2);border-radius:50%;filter:blur(2px)"></div>
          <!-- キャラクター本体 -->
          <div style="position:absolute;inset:0;animation:playerFloat 2s ease-in-out infinite">
            <div style="width:48px;height:48px;background:linear-gradient(135deg,#818cf8,#6366f1);border-radius:50%;border:3px solid white;box-shadow:0 4px 16px rgba(99,102,241,0.6);display:flex;align-items:center;justify-content:center;font-size:22px">
              🧙
            </div>
          </div>
          <!-- オンラインドット -->
          <div style="position:absolute;top:2px;right:2px;width:10px;height:10px;background:#10b981;border:2px solid white;border-radius:50%;box-shadow:0 0 8px #10b981"></div>
        </div>
      `;
      const playerIcon = L.divIcon({
        html: playerHtml,
        className: '',
        iconSize: [48, 48],
        iconAnchor: [24, 48],
      });
      playerMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], {
        icon: playerIcon,
        zIndexOffset: 1000,
      }).addTo(leafletMap.current);

      // プレイヤーを中心に
      leafletMap.current.setView([userLocation.lat, userLocation.lng], 16, { animate: true, duration: 0.5 });
    }

    // クエストマーカー
    locationQuests.forEach(q => {
      const dist = userLocation ? calculateDistance(userLocation.lat, userLocation.lng, q.lat, q.lng) : null;
      const unlocked = dist !== null && dist <= q.radius;
      const rank = q.rank || 'D';
      const rankInfo = RANK_COLORS[rank] || RANK_COLORS.D;

      // パルスアニメーション付きアイコン
      const questHtml = `
        <div style="position:relative;width:40px;height:48px;cursor:pointer">
          ${unlocked ? `<div style="position:absolute;top:0;left:0;width:40px;height:40px;border-radius:50%;background:${rankInfo.glow};animation:questPulse 1.5s infinite;opacity:0.5"></div>` : ''}
          <div style="
            position:absolute;top:0;left:0;
            width:40px;height:40px;
            background:${unlocked ? `linear-gradient(135deg,${rankInfo.glow},${rankInfo.glow}cc)` : 'linear-gradient(135deg,#9ca3af,#6b7280)'};
            border-radius:50% 50% 50% 0;
            transform:rotate(-45deg);
            border:3px solid white;
            box-shadow:0 4px 12px ${unlocked ? rankInfo.glow + '88' : '#00000033'};
          ">
            <div style="transform:rotate(45deg);width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:16px">
              ${unlocked ? rankInfo.icon : '🔒'}
            </div>
          </div>
          ${unlocked ? `<div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);background:${rankInfo.glow};color:white;font-size:9px;font-weight:900;padding:1px 4px;border-radius:4px;white-space:nowrap;box-shadow:0 2px 4px rgba(0,0,0,0.2)">${rank}ランク</div>` : ''}
        </div>
      `;

      const questIcon = L.divIcon({
        html: questHtml,
        className: '',
        iconSize: [40, 48],
        iconAnchor: [20, 48],
      });

      const popupContent = `
        <div style="padding:12px 16px;min-width:200px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-size:20px">${rankInfo.icon}</span>
            <div>
              <div style="font-size:11px;font-weight:900;color:${rankInfo.glow};text-transform:uppercase;letter-spacing:0.05em">${rank}ランク</div>
              <div style="font-size:14px;font-weight:900;color:#1e293b">${q.title}</div>
            </div>
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:8px">${q.description || ''}</div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:12px;font-weight:700;color:${unlocked ? '#10b981' : '#f59e0b'}">
              ${unlocked ? '✅ 範囲内' : `📏 ${formatDistance(dist)}`}
            </span>
            <span style="font-size:12px;font-weight:900;color:#f59e0b">⚡+${q.xp} XP</span>
          </div>
          ${unlocked ? '' : `<div style="margin-top:6px;font-size:10px;color:#94a3b8;text-align:center">あと ${formatDistance(Math.max(0, dist - q.radius))} 近づくと解放</div>`}
        </div>
      `;

      const marker = L.marker([q.lat, q.lng], { icon: questIcon })
        .bindPopup(popupContent, { className: 'quest-popup', maxWidth: 250 })
        .addTo(leafletMap.current);

      marker.on('click', () => setSelectedQuest(q));

      // 範囲サークル
      const circle = L.circle([q.lat, q.lng], {
        radius: q.radius,
        color: unlocked ? rankInfo.glow : '#94a3b8',
        fillColor: unlocked ? rankInfo.glow : '#94a3b8',
        fillOpacity: unlocked ? 0.08 : 0.04,
        weight: unlocked ? 2 : 1,
        dashArray: unlocked ? null : '6,4',
      }).addTo(leafletMap.current);

      markersRef.current.push(marker, circle);
    });
  }, [userLocation, quests, mapReady]);

  const mockLocation = { lat: QUEST_LAT + (mockOffset / 111000), lng: QUEST_LNG };
  const mockDist = calculateDistance(mockLocation.lat, mockLocation.lng, QUEST_LAT, QUEST_LNG);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f0f9ff' }}>

      {/* ヘッダー */}
      <div style={{
        padding: '12px 16px 8px',
        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>🗺️</span>
          <div>
            <div style={{ fontWeight: 900, fontSize: 15 }}>クエストマップ</div>
            <div style={{ fontSize: 10, opacity: 0.8, fontWeight: 700 }}>
              {locationQuests.length}個のクエストが近くにある
            </div>
          </div>
        </div>
        <div style={{
          background: gpsStatus === 'ok' ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)',
          border: `1px solid ${gpsStatus === 'ok' ? '#10b981' : '#f59e0b'}`,
          borderRadius: 20,
          padding: '3px 10px',
          fontSize: 11,
          fontWeight: 900,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: gpsStatus === 'ok' ? '#10b981' : '#f59e0b',
            boxShadow: `0 0 6px ${gpsStatus === 'ok' ? '#10b981' : '#f59e0b'}`,
          }} />
          {gpsStatus === 'ok' ? 'GPS接続中' : 'デモモード'}
        </div>
      </div>

      {/* デモモードスライダー */}
      {gpsStatus === 'mock' && (
        <div style={{
          margin: '8px 12px',
          padding: '10px 14px',
          background: 'rgba(251,191,36,0.1)',
          border: '1.5px solid #fbbf24',
          borderRadius: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <MapPin size={13} color="#f59e0b" />
            <span style={{ fontSize: 11, fontWeight: 900, color: '#92400e' }}>デモ位置を移動</span>
            <span style={{
              marginLeft: 'auto',
              fontSize: 11,
              fontWeight: 900,
              color: mockDist <= 200 ? '#10b981' : '#6b7280',
            }}>
              {mockDist <= 200 ? '🔓 解放！' : formatDistance(mockDist)}
            </span>
          </div>
          <input
            type="range" min={0} max={800} step={10} value={mockOffset}
            onChange={e => setMockOffset(Number(e.target.value))}
            style={{ width: '100%', accentColor: '#6366f1' }}
          />
        </div>
      )}

      {/* マップ本体 */}
      <div style={{ flex: 1, position: 'relative', margin: '0 12px 8px', borderRadius: 20, overflow: 'hidden', boxShadow: '0 8px 32px rgba(99,102,241,0.2)', minHeight: 280 }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: 280 }} />

        {/* 現在地ボタン */}
        {userLocation && (
          <button
            onClick={() => leafletMap.current?.setView([userLocation.lat, userLocation.lng], 16, { animate: true })}
            style={{
              position: 'absolute',
              bottom: 60,
              right: 12,
              zIndex: 999,
              width: 40,
              height: 40,
              background: 'white',
              borderRadius: '50%',
              border: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Navigation size={18} color="#6366f1" />
          </button>
        )}
      </div>

      {/* クエスト一覧 */}
      {locationQuests.length > 0 && (
        <div style={{ padding: '0 12px 12px', maxHeight: 160, overflowY: 'auto' }}>
          <div style={{ fontSize: 11, fontWeight: 900, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            近くのクエスト
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {locationQuests.map(q => {
              const dist = userLocation ? calculateDistance(userLocation.lat, userLocation.lng, q.lat, q.lng) : null;
              const unlocked = dist !== null && dist <= q.radius;
              const rank = q.rank || 'D';
              const rankInfo = RANK_COLORS[rank] || RANK_COLORS.D;
              return (
                <div
                  key={q.id}
                  onClick={() => {
                    setSelectedQuest(q);
                    if (leafletMap.current) leafletMap.current.setView([q.lat, q.lng], 17, { animate: true });
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    background: unlocked ? `linear-gradient(135deg, ${rankInfo.bg}, white)` : 'white',
                    border: `1.5px solid ${unlocked ? rankInfo.glow + '44' : '#e2e8f0'}`,
                    borderRadius: 12,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <span style={{ fontSize: 18 }}>{rankInfo.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.title}</div>
                    <div style={{ fontSize: 10, color: unlocked ? '#10b981' : '#94a3b8', fontWeight: 700 }}>
                      {unlocked ? '✅ 範囲内' : `📏 ${formatDistance(dist)}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2, color: '#f59e0b', fontSize: 11, fontWeight: 900, whiteSpace: 'nowrap' }}>
                    <Zap size={11} />+{q.xp}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default MapTab;
