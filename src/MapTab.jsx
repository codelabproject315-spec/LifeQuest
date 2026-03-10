import React, { useEffect, useRef, useState } from 'react';
import { Navigation, X } from 'lucide-react';
import * as maplibregl from 'maplibre-gl'; // // 👈 ここを追加
import 'maplibre-gl/dist/maplibre-gl.css'; // 👈 スタイルもインポート
import PlayerCharacter from './PlayerCharacter.jsx'; // 新しいファイルをインポート

const MapTab = ({ quests, userLocation, gpsStatus, mockOffset, setMockOffset, QUEST_LAT, QUEST_LNG }) => {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null); // 二重初期化防止
  const [mapInstance, setMapInstance] = useState(null);
  const activeLocation = userLocation || (gpsStatus === 'mock' ? { lat: QUEST_LAT + (mockOffset / 111000), lng: QUEST_LNG } : null);
  const activeLocationRef = useRef(activeLocation);
  useEffect(() => { activeLocationRef.current = activeLocation; }, [activeLocation]);

  useEffect(() => {
    if (mapInstanceRef.current) return; // 二重初期化を確実に防ぐ

    const initLng = activeLocationRef.current?.lng ?? QUEST_LNG;
    const initLat = activeLocationRef.current?.lat ?? QUEST_LAT;

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: 'https://tiles.basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [initLng, initLat], // 最初から現在地にセット（ラグなし）
      zoom: 10,
      pitch: 60,
      bearing: 0, // 常に北向き固定
      antialias: true,
      centerOffset: [0, 150]
    });
    mapInstanceRef.current = map;

    map.on('load', () => {
      // ロード完了後も現在地にjumpTo（アニメーションなし）
      const loc = activeLocationRef.current;
      if (loc) {
        map.jumpTo({ center: [loc.lng, loc.lat] });
      }
      // リアルタイム再描画（キャラアニメーション用）
      const repaintInterval = setInterval(() => map.triggerRepaint(), 16);
      map._repaintInterval = repaintInterval;
      setMapInstance(map);
      // 3D建物レイヤー
      const sources = map.getStyle().sources;
      const buildingSource = Object.keys(sources).find(k => sources[k].type === 'vector') ?? 'openmaptiles';
      try {
        map.addLayer({
          'id': '3d-buildings',
          'source': buildingSource,
          'source-layer': 'building',
          'type': 'fill-extrusion',
          'minzoom': 15,
          'paint': {
            'fill-extrusion-color': '#7ecfcf',
            'fill-extrusion-height': ['get', 'render_height']
          }
        });
      } catch (e) { console.warn('3d-buildings layer error:', e); }

      // 道路を太くする
      const roadLayers = map.getStyle().layers.filter(l => l['source-layer'] === 'transportation');
      roadLayers.forEach(l => {
        try {
          if (l.type === 'line') {
            map.setPaintProperty(l.id, 'line-width', [
              'interpolate', ['exponential', 1.5], ['zoom'],
              10, ['*', ['get', 'width'], 3],
              18, 50
            ]);
          }
        } catch (e) {}
      });
    });

    return () => {
      if (map._repaintInterval) clearInterval(map._repaintInterval);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // 位置の追従ロジック（ポケGoっぽくキャラの後ろからカメラ追従）
  useEffect(() => {
    if (mapInstance && activeLocation) {
      mapInstance.easeTo({
        center: [activeLocation.lng, activeLocation.lat],
        zoom: 18,
        pitch: 75,
        duration: 800,
        easing: (t) => t
      });
    }
  }, [activeLocation, mapInstance]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      
      {/* 3Dキャラクターを地図に重ねる */}
      {mapInstance && <PlayerCharacter map={mapInstance} lat={activeLocation?.lat ?? QUEST_LAT} lng={activeLocation?.lng ?? QUEST_LNG} bearing={mapInstance.getBearing()} />}

      {/* 現在地ボタンなどのUI */}
      <button 
        onClick={() => mapInstance?.easeTo({ center: [activeLocation.lng, activeLocation.lat], zoom: 18 })}
        style={{ position: 'absolute', bottom: 180, right: 10, zIndex: 500 }}
      >
        <Navigation size={24} />
      </button>
    </div>
  );
};

export default MapTab;
