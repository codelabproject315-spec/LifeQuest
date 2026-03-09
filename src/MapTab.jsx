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
  const mapGL = useRef(null);
  const markersRef = useRef({});
  const playerMarkerRef = useRef(null);
  const [selectedQuest, setSelectedQuest] = useState(null);
  const [mapReady, setMapReady] = useState(false);

  const locationQuests = quests.filter(q => q.type === 'location');
  const mockLocation = { lat: QUEST_LAT + (mockOffset / 111000), lng: QUEST_LNG };
  const mockDist = calculateDistance(mockLocation.lat, mockLocation.lng, QUEST_LAT, QUEST_LNG);
  const activeLocation = userLocation || (gpsStatus === 'mock' ? mockLocation : null);

  // MapLibre GL 初期化
  useEffect(() => {
    if (mapGL.current) return;

    // 3D用のグローバルスタイル注入
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      .maplibregl-canvas { outline: none; }
      .marker-3d { 
        transform-style: preserve-3d; 
        transition: transform 0.2s ease;
      }
      @keyframes float3d { 
        0%, 100% { transform: translateY(0) rotateX(-60deg); } 
        50% { transform: translateY(-10px) rotateX(-60deg); } 
      }
      @keyframes radarRing3d { 
        0% { transform: scale(0.6) rotateX(90deg); opacity: 0.8; } 
        100% { transform: scale(2.5) rotateX(90deg); opacity: 0; } 
      }
    `;
    document.head.appendChild(styleEl);

    const initMap = () => {
      const map = new window.maplibregl.Map({
        container: mapRef.current,
        style: 'https://tiles.basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
        center: [QUEST_LNG, QUEST_LAT],
        zoom: 16.5,
        pitch: 65, // ポケモンGO風の傾き
        bearing: 0,
        antialias: true
      });

      map.on('load', () => {
        // 3D建物の表示設定
        map.addLayer({
          'id': '3d-buildings',
          'source': 'openmaptiles',
          'source-layer': 'building',
          'type': 'fill-extrusion',
          'minzoom': 15,
          'paint': {
            'fill-extrusion-color': '#e0e0e0',
            'fill-extrusion-height': ['get', 'render_height'],
            'fill-extrusion-base': ['get', 'render_min_height'],
            'fill-extrusion-opacity': 0.6
          }
        });
        mapGL.current = map;
        setMapReady(true);
      });
    };

    // スクリプト動的読み込み
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

  // プレイヤー & クエストマーカー更新
  useEffect(() => {
    if (!mapGL.current || !mapReady) return;

    // プレイヤーマーカー
    if (activeLocation) {
      if (!playerMarkerRef.current) {
        const el = document.createElement('div');
        el.className = 'marker-3d';
        el.innerHTML = `
          <div style="position:relative; width:60px; height:60px;">
            <div style="position:absolute; inset:-10px; border:3px solid #6366f1; border-radius:50%; animation: radarRing3d 2s infinite;"></div>
            <div style="width:60px; height:60px; background:linear-gradient(135deg,#818cf8,#6366f1); border-radius:50%; border:3px solid white; display:flex; align-items:center; justify-content:center; font-size:30px; box-shadow:0 10px 20px rgba(0,0,0,0.3); animation: float3d 2s infinite;">
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
      mapGL.current.easeTo({ center: [activeLocation.lng, activeLocation.lat], duration: 1000 });
    }

    // クエストマーカーの同期
    locationQuests.forEach(q => {
      if (!markersRef.current[q.id]) {
        const cfg = RANK_CONFIG[q.rank || 'D'];
        const el = document.createElement('div');
        el.className = 'marker-3d';
        el.style.cursor = 'pointer';
        el.innerHTML = `
          <div style="width:40px; height:40px; background:${cfg.color}; border:3px solid white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:20px; box-shadow:0 8px 15px ${cfg.glow}; animation: float3d ${2 + Math.random()}s infinite;">
            ${cfg.emoji}
          </div>
        `;
        el.onclick = () => setSelectedQuest(q);
        const marker = new window.maplibregl.Marker({ element: el })
          .setLngLat([q.lng, q.lat])
          .addTo(mapGL.current);
        markersRef.current[q.id] = marker;
      }
    });
  }, [activeLocation, quests, mapReady]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#eef2f3' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* UIパーツ (既存のHUD、スライダー、ボタン等をそのまま配置) */}
      {/* ... [App.js等から引き継いだUIコードをここに配置] ... */}
      
      {/* 修正した現在地ボタン */}
      {activeLocation && (
        <button
          onClick={() => mapGL.current?.easeTo({ center: [activeLocation.lng, activeLocation.lat], pitch: 65, zoom: 16.5 })}
          style={{
            position: 'absolute', bottom: 180, right: 10, zIndex: 500,
            width: 48, height: 48, borderRadius: '50%', background: 'white', border: 'none',
            boxShadow: '0 4px 15px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          <Navigation size={22} color="#6366f1" />
        </button>
      )}
      
      {/* クエスト詳細パネル等は既存のものを流用 */}
      {selectedQuest && (
        <div style={{ position: 'absolute', bottom: 20, left: 15, right: 15, zIndex: 1000, background: 'rgba(15,23,42,0.95)', padding: 20, borderRadius: 25, color: 'white' }}>
          <button onClick={() => setSelectedQuest(null)} style={{ float: 'right' }}><X size={20}/></button>
          <h3 style={{ fontWeight: 900 }}>{selectedQuest.title}</h3>
          <p>{selectedQuest.description}</p>
        </div>
      )}
    </div>
  );
};

export default MapTab;
