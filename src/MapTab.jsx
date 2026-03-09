import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Zap, X, Navigation } from 'lucide-react';

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

const RANK_CONFIG = {
  S: { color: '#f59e0b', glow: 'rgba(245,158,11,0.6)', emoji: '👑' },
  A: { color: '#8b5cf6', glow: 'rgba(139,92,246,0.6)', emoji: '⚡' },
  B: { color: '#3b82f6', glow: 'rgba(59,130,246,0.6)', emoji: '🔵' },
  C: { color: '#10b981', glow: 'rgba(16,185,129,0.6)', emoji: '🟢' },
  D: { color: '#6b7280', glow: 'rgba(107,114,128,0.4)', emoji: '⚪' },
};

const MapTab = ({ quests, userLocation, gpsStatus, mockOffset, setMockOffset, QUEST_LAT, QUEST_LNG }) => {
  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef([]);
  const playerMarkerRef = useRef(null);
  const followPlayer = useRef(true);
  const [selectedQuest, setSelectedQuest] = useState(null);
  const [mapReady, setMapReady] = useState(false);

  const locationQuests = quests.filter(q => q.type === 'location');
  const mockLocation = { lat: QUEST_LAT + (mockOffset / 111000), lng: QUEST_LNG };
  const mockDist = calculateDistance(mockLocation.lat, mockLocation.lng, QUEST_LAT, QUEST_LNG);
  const activeLocation = userLocation || (gpsStatus === 'mock' ? mockLocation : null);

  // Leaflet初期化
  useEffect(() => {
    if (leafletMap.current) return;

    const styles = `
      .leaflet-container { font-family: system-ui, sans-serif; }
      .leaflet-control-zoom { border: none !important; box-shadow: 0 4px 12px rgba(0,0,0,0.2) !important; border-radius: 12px !important; overflow: hidden; }
      .leaflet-control-zoom a { background: rgba(255,255,255,0.95) !important; color: #6366f1 !important; font-weight: 900 !important; border: none !important; width: 36px !important; height: 36px !important; line-height: 36px !important; font-size: 18px !important; }
      .quest-popup .leaflet-popup-content-wrapper { background: rgba(15,15,30,0.92); backdrop-filter: blur(16px); border-radius: 18px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1); padding: 0; }
      .quest-popup .leaflet-popup-tip-container { display: none; }
      .quest-popup .leaflet-popup-content { margin: 0; color: white; }
      .leaflet-popup-close-button { color: rgba(255,255,255,0.6) !important; font-size: 20px !important; top: 8px !important; right: 10px !important; }
      @keyframes playerPulse { 0%,100%{transform:scale(1);opacity:0.8} 50%{transform:scale(1.6);opacity:0} }
      @keyframes questPulse { 0%,100%{transform:scale(1);opacity:0.7} 50%{transform:scale(1.8);opacity:0} }
      @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
      @keyframes radarRing { 0%{transform:scale(0.6);opacity:0.8} 100%{transform:scale(2.5);opacity:0} }
      @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      .leaflet-bottom.leaflet-right { margin-bottom: 100px !important; }
    `;
    const styleEl = document.createElement('style');
    styleEl.textContent = styles;
    document.head.appendChild(styleEl);

    const loadLeaflet = () => {
      if (!mapRef.current || leafletMap.current) return;
      const L = window.L;
      const map = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false,
      }).setView([QUEST_LAT, QUEST_LNG], 16);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 19, subdomains: 'abcd',
      }).addTo(map);

      L.control.zoom({ position: 'bottomright' }).addTo(map);
      map.on('dragstart', () => { followPlayer.current = false; });
      leafletMap.current = map;
      setMapReady(true);
    };

    if (window.L) { loadLeaflet(); return; }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = loadLeaflet;
    document.head.appendChild(script);
  }, []);

  // マーカー更新
  useEffect(() => {
    if (!leafletMap.current || !window.L || !mapReady) return;
    const L = window.L;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    if (playerMarkerRef.current) playerMarkerRef.current.remove();

    // プレイヤー
    if (activeLocation) {
      const playerHtml = `
        <div style="position:relative;width:56px;height:56px">
          <div style="position:absolute;inset:-6px;border-radius:50%;border:2px solid #818cf8;animation:radarRing 2s infinite"></div>
          <div style="position:absolute;inset:-6px;border-radius:50%;border:2px solid #818cf8;animation:radarRing 2s 1s infinite"></div>
          <div style="position:absolute;bottom:-4px;left:50%;transform:translateX(-50%);width:28px;height:8px;background:rgba(0,0,0,0.18);border-radius:50%;filter:blur(3px)"></div>
          <div style="position:absolute;inset:0;animation:float 2.2s ease-in-out infinite">
            <div style="width:56px;height:56px;background:linear-gradient(135deg,#818cf8,#6366f1);border-radius:50%;border:3px solid white;box-shadow:0 0 0 3px rgba(99,102,241,0.3),0 6px 20px rgba(99,102,241,0.5);display:flex;align-items:center;justify-content:center;font-size:26px">
              🧙
            </div>
          </div>
          <div style="position:absolute;top:2px;right:2px;width:12px;height:12px;background:#10b981;border:2.5px solid white;border-radius:50%;box-shadow:0 0 8px #10b981"></div>
        </div>
      `;
      const playerIcon = L.divIcon({ html: playerHtml, className: '', iconSize: [56, 56], iconAnchor: [28, 56] });
      playerMarkerRef.current = L.marker([activeLocation.lat, activeLocation.lng], { icon: playerIcon, zIndexOffset: 1000 }).addTo(leafletMap.current);
      if (followPlayer.current) {
        leafletMap.current.setView([activeLocation.lat, activeLocation.lng], 16, { animate: true, duration: 0.8 });
      }
    }

    // クエストマーカー
    locationQuests.forEach(q => {
      const dist = activeLocation ? calculateDistance(activeLocation.lat, activeLocation.lng, q.lat, q.lng) : null;
      const unlocked = dist !== null && dist <= q.radius;
      const cfg = RANK_CONFIG[q.rank || 'D'] || RANK_CONFIG.D;

      const questHtml = `
        <div style="position:relative;width:48px;height:58px;cursor:pointer">
          ${unlocked ? `
            <div style="position:absolute;top:0;left:0;width:48px;height:48px;border-radius:50%;background:${cfg.color};animation:questPulse 1.8s infinite;opacity:0.5"></div>
            <div style="position:absolute;top:0;left:0;width:48px;height:48px;border-radius:50%;background:${cfg.color};animation:questPulse 1.8s 0.9s infinite;opacity:0.3"></div>
          ` : ''}
          <div style="position:absolute;top:0;left:0;width:48px;height:48px;animation:float ${2 + Math.random()}s ease-in-out infinite">
            <div style="
              width:48px;height:48px;
              background:${unlocked ? `linear-gradient(135deg,${cfg.color},${cfg.color}cc)` : 'linear-gradient(135deg,#9ca3af,#6b7280)'};
              border-radius:50% 50% 50% 0;
              transform:rotate(-45deg);
              border:3px solid white;
              box-shadow:0 4px 16px ${unlocked ? cfg.glow : 'rgba(0,0,0,0.2)'};
              display:flex;align-items:center;justify-content:center;
            ">
              <div style="transform:rotate(45deg);font-size:20px">${unlocked ? cfg.emoji : '🔒'}</div>
            </div>
          </div>
          ${unlocked ? `
            <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);background:${cfg.color};color:white;font-size:9px;font-weight:900;padding:2px 6px;border-radius:6px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.2)">${q.rank || 'D'}ランク</div>
          ` : ''}
        </div>
      `;

      const questIcon = L.divIcon({ html: questHtml, className: '', iconSize: [48, 58], iconAnchor: [24, 58] });
      const marker = L.marker([q.lat, q.lng], { icon: questIcon })
        .addTo(leafletMap.current);

      marker.on('click', () => setSelectedQuest(q));

      const circle = L.circle([q.lat, q.lng], {
        radius: q.radius,
        color: unlocked ? cfg.color : '#9ca3af',
        fillColor: unlocked ? cfg.color : '#9ca3af',
        fillOpacity: unlocked ? 0.08 : 0.04,
        weight: unlocked ? 2 : 1,
        dashArray: unlocked ? null : '6,4',
      }).addTo(leafletMap.current);

      markersRef.current.push(marker, circle);
    });
  }, [userLocation, quests, mapReady, mockOffset]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* マップ本体（全画面） */}
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* ヘッダーHUD */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 500,
        padding: '12px 14px',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.55), transparent)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        pointerEvents: 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>🗺️</span>
          <div>
            <div style={{ color: 'white', fontWeight: 900, fontSize: 15, textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>クエストマップ</div>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: 700 }}>{locationQuests.length}個のクエストが近くにある</div>
          </div>
        </div>
        <div style={{
          background: gpsStatus === 'ok' ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)',
          border: `1px solid ${gpsStatus === 'ok' ? '#10b981' : '#f59e0b'}`,
          borderRadius: 20, padding: '4px 10px',
          display: 'flex', alignItems: 'center', gap: 5,
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: gpsStatus === 'ok' ? '#10b981' : '#f59e0b', boxShadow: `0 0 6px ${gpsStatus === 'ok' ? '#10b981' : '#f59e0b'}` }} />
          <span style={{ color: 'white', fontSize: 11, fontWeight: 900 }}>{gpsStatus === 'ok' ? 'GPS接続中' : 'デモモード'}</span>
        </div>
      </div>

      {/* デモスライダー */}
      {gpsStatus === 'mock' && (
        <div style={{
          position: 'absolute', top: 60, left: 12, right: 12, zIndex: 500,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)',
          borderRadius: 14, padding: '10px 14px',
          border: '1px solid rgba(251,191,36,0.4)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <MapPin size={12} color="#fbbf24" />
            <span style={{ color: '#fbbf24', fontSize: 11, fontWeight: 900 }}>デモ位置を移動</span>
            <span style={{ marginLeft: 'auto', color: mockDist <= 200 ? '#10b981' : '#94a3b8', fontSize: 11, fontWeight: 900 }}>
              {mockDist <= 200 ? '🔓 解放！' : formatDistance(mockDist)}
            </span>
          </div>
          <input type="range" min={0} max={800} step={10} value={mockOffset}
            onChange={e => setMockOffset(Number(e.target.value))}
            style={{ width: '100%', accentColor: '#818cf8' }} />
        </div>
      )}

      {/* 現在地ボタン */}
      {activeLocation && (
        <button
          onClick={() => {
            followPlayer.current = true;
            leafletMap.current?.setView([activeLocation.lat, activeLocation.lng], 16, { animate: true });
          }}
          style={{
            position: 'absolute', bottom: 190, right: 10, zIndex: 500,
            width: 42, height: 42, borderRadius: '50%',
            background: 'white', border: 'none',
            boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}
        >
          <Navigation size={18} color="#6366f1" />
        </button>
      )}

      {/* クエスト横スクロールリスト */}
      {locationQuests.length > 0 && !selectedQuest && (
        <div style={{ position: 'absolute', bottom: 12, left: 0, right: 0, zIndex: 500, padding: '0 12px' }}>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>
            {locationQuests.map(q => {
              const dist = activeLocation ? calculateDistance(activeLocation.lat, activeLocation.lng, q.lat, q.lng) : null;
              const unlocked = dist !== null && dist <= q.radius;
              const cfg = RANK_CONFIG[q.rank || 'D'] || RANK_CONFIG.D;
              return (
                <button key={q.id} onClick={() => {
                  setSelectedQuest(q);
                  if (leafletMap.current) leafletMap.current.setView([q.lat, q.lng], 17, { animate: true });
                }} style={{
                  flexShrink: 0, cursor: 'pointer',
                  background: unlocked ? `linear-gradient(135deg,${cfg.color}44,rgba(0,0,0,0.7))` : 'rgba(0,0,0,0.65)',
                  backdropFilter: 'blur(12px)',
                  border: `1.5px solid ${unlocked ? cfg.color + '88' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 14, padding: '8px 12px',
                  display: 'flex', alignItems: 'center', gap: 8, minWidth: 155,
                }}>
                  <span style={{ fontSize: 20 }}>{cfg.emoji}</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ color: 'white', fontWeight: 900, fontSize: 11, whiteSpace: 'nowrap', maxWidth: 95, overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.title}</div>
                    <div style={{ color: unlocked ? '#10b981' : '#94a3b8', fontSize: 10, fontWeight: 700 }}>
                      {unlocked ? '✅ 範囲内' : `📏 ${formatDistance(dist)}`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* クエスト詳細パネル */}
      {selectedQuest && (() => {
        const q = selectedQuest;
        const dist = activeLocation ? calculateDistance(activeLocation.lat, activeLocation.lng, q.lat, q.lng) : null;
        const unlocked = dist !== null && dist <= q.radius;
        const cfg = RANK_CONFIG[q.rank || 'D'] || RANK_CONFIG.D;
        return (
          <div style={{
            position: 'absolute', bottom: 12, left: 12, right: 12, zIndex: 500,
            background: 'rgba(10,10,25,0.92)', backdropFilter: 'blur(20px)',
            borderRadius: 22, border: `1.5px solid ${cfg.color}55`,
            padding: 16, boxShadow: `0 12px 40px ${cfg.glow}`,
          }}>
            <button onClick={() => setSelectedQuest(null)} style={{
              position: 'absolute', top: 12, right: 12,
              background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%',
              width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}><X size={14} color="white" /></button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: cfg.color + '33', border: `2px solid ${cfg.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{cfg.emoji}</div>
              <div>
                <div style={{ color: cfg.color, fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{q.rank || 'D'}ランク</div>
                <div style={{ color: 'white', fontWeight: 900, fontSize: 15 }}>{q.title}</div>
              </div>
            </div>
            {q.description && <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, marginBottom: 10 }}>{q.description}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: unlocked ? '#10b981' : '#f59e0b', fontWeight: 900, fontSize: 13 }}>
                {unlocked ? '✅ 範囲内 — クリアできる！' : `📏 あと ${formatDistance(Math.max(0, dist - q.radius))}`}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#fbbf24', fontWeight: 900, fontSize: 14 }}>
                <Zap size={14} />+{q.xp} XP
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default MapTab;
