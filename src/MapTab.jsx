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

  // 1. MapLibre GL 初期化と3Dビルボード設定
  useEffect(() => {
    if (mapGL.current) return;

    const styleEl = document.createElement('style');
    styleEl.textContent = `
      .maplibregl-canvas { outline: none; }
      
      /* 3D空間の設定 */
      .marker-3d-container {
        perspective: 1000px;
        transform-style: preserve-3d;
        width: 100px;
        height: 100px;
        display: flex;
        justify-content: center;
        align-items: flex-end;
      }

      /* 地図の傾斜(-65度)を打ち消して垂直に立たせる */
      .character-billboard {
        transform-style: preserve-3d;
        transform: rotateX(-65deg); 
        display: flex;
        flex-direction: column;
        align-items: center;
        position: relative;
        z-index: 2;
      }

      /* キャラクターの浮遊アニメーション */
      @keyframes float-hero {
        0%, 100% { transform: rotateX(-65deg) translateY(0); }
        50% { transform: rotateX(-65deg) translateY(-25px); }
      }

      /* 地面に張り付く影 */
      .character-shadow {
        position: absolute;
        bottom: 0;
        left: 50%;
        margin-left: -25px;
        width: 50px;
        height: 20px;
        background: rgba(0,0,0,0.35);
        border-radius: 50%;
        filter: blur(5px);
        transform: rotateX(90deg); /* 地面に水平に寝かせる */
        z-index: 1;
      }

      @keyframes radarRing3d { 
        0% { transform: scale(0.6) rotateX(90deg); opacity: 0.8; } 
        100% { transform: scale(3.5) rotateX(90deg); opacity: 0; } 
      }
    `;
    document.head.appendChild(styleEl);

    const initMap = () => {
      const map = new window.maplibregl.Map({
        container: mapRef.current,
        style: 'https://tiles.basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
        center: [QUEST_LNG, QUEST_LAT],
        zoom: 17.5,
        pitch: 65, 
        bearing: 0,
        antialias: true
      });

      map.on('load', () => {
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
            'fill-extrusion-opacity': 0.7
          }
        });
        mapRef.current.style.background = 'linear-gradient(to top, #aacbff 50%, #3a8dff 100%)';
        mapGL.current = map;
        setMapReady(true);
      });
    };

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

  // 2. プレイヤーマーカーの更新 (3Dビルボード強化)
  useEffect(() => {
    if (!mapGL.current || !mapReady || !activeLocation) return;

    if (!playerMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'marker-3d-container';
      el.innerHTML = `
        <div class="character-shadow"></div>
        <div class="character-billboard" style="animation: float-hero 2.2s ease-in-out infinite;">
          <div style="position:relative; width:80px; height:80px;">
            <div style="position:absolute; inset:-12px; border:5px solid #6366f1; border-radius:50%; animation: radarRing3d 2s infinite;"></div>
            <div style="
              width:80px; height:80px; 
              background:linear-gradient(135deg,#818cf8,#6366f1); 
              border-radius:50%; border:5px solid white; 
              display:flex; align-items:center; justify-content:center; 
              font-size:50px; 
              box-shadow: 0 15px 40px rgba(0,0,0,0.5);
            ">
              🧙
            </div>
          </div>
        </div>
      `;
      playerMarkerRef.current = new window.maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([activeLocation.lng, activeLocation.lat])
        .addTo(mapGL.current);
    } else {
      playerMarkerRef.current.setLngLat([activeLocation.lng, activeLocation.lat]);
    }

    mapGL.current.easeTo({ center: [activeLocation.lng, activeLocation.lat], duration: 1000 });
  }, [activeLocation, mapReady]);

  // 3. クエストマーカーの更新
  useEffect(() => {
    if (!mapGL.current || !mapReady) return;

    locationQuests.forEach(q => {
      if (!markersRef.current[q.id]) {
        const cfg = RANK_CONFIG[q.rank || 'D'];
        const el = document.createElement('div');
        el.className = 'marker-3d-container';
        el.innerHTML = `
          <div class="character-shadow"></div>
          <div class="character-billboard" style="animation: float-hero ${2 + Math.random()}s ease-in-out infinite;">
            <div style="width:50px; height:50px; background:${cfg.color}; border:3px solid white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:25px; box-shadow:0 10px 25px ${cfg.glow};">
              ${cfg.emoji}
            </div>
          </div>
        `;
        el.onclick = () => setSelectedQuest(q);
        markersRef.current[q.id] = new window.maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([q.lng, q.lat])
          .addTo(mapGL.current);
      }
    });
  }, [quests, mapReady]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* 現在地ボタン */}
      {activeLocation && (
        <button
          onClick={() => mapGL.current?.easeTo({ center: [activeLocation.lng, activeLocation.lat], pitch: 65, zoom: 17.5 })}
          style={{
            position: 'absolute', bottom: 180, right: 10, zIndex: 500,
            width: 50, height: 50, borderRadius: '50%', background: 'white', border: 'none',
            boxShadow: '0 5px 20px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          <Navigation size={24} color="#6366f1" />
        </button>
      )}

      {/* 詳細パネル */}
      {selectedQuest && (
        <div style={{
          position: 'absolute', bottom: 30, left: 20, right: 20, zIndex: 1000,
          background: 'white', padding: '25px', borderRadius: '35px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)', border: '1px solid #f1f5f9'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
            <span style={{ background: RANK_CONFIG[selectedQuest.rank || 'D'].color, color: 'white', padding: '5px 15px', borderRadius: 15, fontSize: 12, fontWeight: 900 }}>
              {selectedQuest.rank} RANK
            </span>
            <button onClick={() => setSelectedQuest(null)} style={{ background: '#f1f5f9', border: 'none', borderRadius: '50%', padding: 8 }}><X size={24} color="#94a3b8"/></button>
          </div>
          <h3 style={{ fontSize: 24, fontWeight: 900, color: '#1e293b' }}>{selectedQuest.title}</h3>
          <p style={{ color: '#64748b', fontSize: 16, marginTop: 8 }}>{selectedQuest.description}</p>
        </div>
      )}
    </div>
  );
};

export default MapTab;
