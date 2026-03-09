import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Zap, X, Navigation } from 'lucide-react';

// 距離計算ロジック
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

// ランクごとの色の設定
const RANK_CONFIG = {
  S: { color: '#f59e0b', glow: 'rgba(245,158,11,0.6)', emoji: '👑' },
  A: { color: '#8b5cf6', glow: 'rgba(139,92,246,0.6)', emoji: '⚡' },
  B: { color: '#3b82f6', glow: 'rgba(59,130,246,0.6)', emoji: '🔵' },
  C: { color: '#10b981', glow: 'rgba(16,185,129,0.6)', emoji: '🟢' },
  D: { color: '#6b7280', glow: 'rgba(107,114,128,0.4)', emoji: '⚪' },
};

const MapTab = ({ quests, userLocation, gpsStatus, mockOffset, setMockOffset, QUEST_LAT, QUEST_LNG }) => {
  const mapRef = useRef(null);
  const mapGL = useRef(null);
  const markersRef = useRef({});
  const playerMarkerRef = useRef(null);
  const [selectedQuest, setSelectedQuest] = useState(null);
  const [mapReady, setMapReady] = useState(false);

  const locationQuests = quests.filter(q => q.type === 'location');
  const mockLocation = { lat: QUEST_LAT + (mockOffset / 111000), lng: QUEST_LNG };
  const mockDist = calculateDistance(mockLocation.lat, mockLocation.lng, QUEST_LAT, QUEST_LNG);
  const activeLocation = userLocation || (gpsStatus === 'mock' ? mockLocation : null);

  // 1. MapLibre GL 初期化と3D設定
  useEffect(() => {
    if (mapGL.current) return;

    // 3D表現用のカスタムCSS注入
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      .maplibregl-canvas { outline: none; }
      .marker-3d { transform-style: preserve-3d; }
      /* ポケモンGOのようにキャラを垂直に立たせるアニメーション */
      @keyframes float3d { 
        0%, 100% { transform: translateY(0) rotateX(-65deg); } 
        50% { transform: translateY(-15px) rotateX(-65deg); } 
      }
      @keyframes radarRing3d { 
        0% { transform: scale(0.6) rotateX(90deg); opacity: 0.8; } 
        100% { transform: scale(3) rotateX(90deg); opacity: 0; } 
      }
    `;
    document.head.appendChild(styleEl);

    const initMap = () => {
      const map = new window.maplibregl.Map({
        container: mapRef.current,
        style: 'https://tiles.basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
        center: [QUEST_LNG, QUEST_LAT],
        zoom: 17,
        pitch: 65, // 👈 斜め見下ろし視点
        bearing: 0,
        antialias: true
      });

      map.on('load', () => {
        // 3D建物のレイヤー追加
        map.addLayer({
          'id': '3d-buildings',
          'source': 'openmaptiles',
          'source-layer': 'building',
          'type': 'fill-extrusion',
          'minzoom': 15,
          'paint': {
            'fill-extrusion-color': '#aacbff',
            'fill-extrusion-height': ['get', 'render_height'],
            'fill-extrusion-base': ['get', 'render_min_height'],
            'fill-extrusion-opacity': 0.8
          }
        });

        // 背景に空のグラデーションを設定
        mapRef.current.style.background = 'linear-gradient(to top, #aacbff 50%, #3a8dff 100%)';
        
        mapGL.current = map;
        setMapReady(true);
      });
    };

    // ライブラリの動的読み込み
    if (!window.maplibregl) {
      const link = document.createElement('link');
      link.href = 'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js';
      script.onload = initMap;
      document.head.appendChild(script);
    } else {
      initMap();
    }
  }, []);

  // 2. プレイヤーマーカーの更新
  useEffect(() => {
    if (!mapGL.current || !mapReady || !activeLocation) return;

    if (!playerMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'marker-3d';
      el.innerHTML = `
        <div style="position:relative; width:70px; height:70px;">
          <div style="position:absolute; inset:-10px; border:4px solid #6366f1; border-radius:50%; animation: radarRing3d 2s infinite;"></div>
          <div style="width:70px; height:70px; background:linear-gradient(135deg,#818cf8,#6366f1); border-radius:50%; border:4px solid white; display:flex; align-items:center; justify-content:center; font-size:35px; box-shadow:0 10px 25px rgba(0,0,0,0.4); animation: float3d 2s infinite;">
            🧙
          </div>
        </div>
      `;
      playerMarkerRef.current = new window.maplibregl.Marker({ element: el })
        .setLngLat([activeLocation.lng, activeLocation.lat])
        .addTo(mapGL.current);
    } else {
      playerMarkerRef.current.setLngLat([activeLocation.lng, activeLocation.lat]);
    }

    // カメラがプレイヤーを追従
    mapGL.current.easeTo({
      center: [activeLocation.lng, activeLocation.lat],
      duration: 1000
    });
  }, [activeLocation, mapReady]);

  // 3. クエストマーカーの同期
  useEffect(() => {
    if (!mapGL.current || !mapReady) return;

    locationQuests.forEach(q => {
      if (!markersRef.current[q.id]) {
        const cfg = RANK_CONFIG[q.rank || 'D'];
        const el = document.createElement('div');
        el.className = 'marker-3d';
        el.style.cursor = 'pointer';
        el.innerHTML = `
          <div style="width:45px; height:45px; background:${cfg.color}; border:3px solid white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:22px; box-shadow:0 8px 20px ${cfg.glow}; animation: float3d ${2 + Math.random()}s infinite;">
            ${cfg.emoji}
          </div>
        `;
        el.onclick = () => setSelectedQuest(q);
        markersRef.current[q.id] = new window.maplibregl.Marker({ element: el })
          .setLngLat([q.lng, q.lat])
          .addTo(mapGL.current);
      }
    });
  }, [quests, mapReady]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* マップコンテナ */}
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* 現在地ボタン */}
      {activeLocation && (
        <button
          onClick={() => mapGL.current?.easeTo({ center: [activeLocation.lng, activeLocation.lat], pitch: 65, zoom: 17 })}
          style={{
            position: 'absolute', bottom: 180, right: 10, zIndex: 500,
            width: 48, height: 48, borderRadius: '50%', background: 'white', border: 'none',
            boxShadow: '0 4px 15px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          <Navigation size={22} color="#6366f1" />
        </button>
      )}

      {/* デモスライダー (GPSがmockの場合のみ表示) */}
      {gpsStatus === 'mock' && (
        <div style={{
          position: 'absolute', top: 70, left: 15, right: 15, zIndex: 500,
          background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(10px)',
          borderRadius: 20, padding: 15, boxShadow: '0 8px 32px rgba(0,0,0,0.1)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
             <span style={{ fontWeight: 900, fontSize: 12, color: '#6366f1' }}>デモ位置移動</span>
             <span style={{ fontWeight: 900, fontSize: 12 }}>{formatDistance(mockDist)}</span>
          </div>
          <input type="range" min={0} max={800} step={10} value={mockOffset} 
                 onChange={e => setMockOffset(Number(e.target.value))}
                 style={{ width: '100%', accentColor: '#6366f1' }} />
        </div>
      )}

      {/* クエスト詳細パネル */}
      {selectedQuest && (
        <div style={{
          position: 'absolute', bottom: 25, left: 15, right: 15, zIndex: 1000,
          background: 'white', padding: 25, borderRadius: 30,
          boxShadow: '0 15px 50px rgba(0,0,0,0.2)', border: '1px solid #f1f5f9'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ background: RANK_CONFIG[selectedQuest.rank || 'D'].color, color: 'white', padding: '4px 12px', borderRadius: 12, fontSize: 10, fontWeight: 900 }}>
              {selectedQuest.rank} RANK
            </span>
            <button onClick={() => setSelectedQuest(null)} style={{ background: '#f1f5f9', border: 'none', borderRadius: '50%', p: 5 }}><X size={20} color="#94a3b8"/></button>
          </div>
          <h3 style={{ fontSize: 20, fontWeight: 900, color: '#1e293b' }}>{selectedQuest.title}</h3>
          <p style={{ color: '#64748b', fontSize: 14, marginTop: 5 }}>{selectedQuest.description}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 15, color: '#f59e0b', fontWeight: 900 }}>
            <Zap size={16} /> +{selectedQuest.xp} XP
          </div>
        </div>
      )}
    </div>
  );
};

export default MapTab;
