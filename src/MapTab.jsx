import React, { useEffect, useRef, useState } from 'react';
import { Navigation, X } from 'lucide-react';
import * as maplibregl from 'maplibre-gl'; // // 👈 ここを追加
import 'maplibre-gl/dist/maplibre-gl.css'; // 👈 スタイルもインポート
import PlayerCharacter from './PlayerCharacter.jsx'; // 新しいファイルをインポート

const MapTab = ({ quests, userLocation, gpsStatus, mockOffset, setMockOffset, QUEST_LAT, QUEST_LNG }) => {
  const mapRef = useRef(null);
  const [mapInstance, setMapInstance] = useState(null);
  const activeLocation = userLocation || (gpsStatus === 'mock' ? { lat: QUEST_LAT + (mockOffset / 111000), lng: QUEST_LNG } : null);

  useEffect(() => {
    if (mapInstance) return;

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: 'https://tiles.basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
      center: [QUEST_LNG, QUEST_LAT],
      zoom: 18,
      pitch: 65,
      antialias: true
    });

    map.on('load', () => {
      setMapInstance(map);
      // 3D建物などの共通レイヤー設定
      const sources = map.getStyle().sources;
      const buildingSource = Object.keys(sources).find(k => sources[k].type === 'vector') ?? 'openmaptiles';
      map.addLayer({
        'id': '3d-buildings',
        'source': buildingSource,
        'source-layer': 'building',
        'type': 'fill-extrusion',
        'minzoom': 15,
        'paint': {
          'fill-extrusion-color': '#aacbff',
          'fill-extrusion-height': ['get', 'render_height']
        }
      });
    });
  }, []);

  // 位置の追従ロジック
  useEffect(() => {
    if (mapInstance && activeLocation) {
      mapInstance.easeTo({
        center: [activeLocation.lng, activeLocation.lat],
        duration: 1000
      });
    }
  }, [activeLocation, mapInstance]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      
      {/* 3Dキャラクターを地図に重ねる */}
      {mapInstance && <PlayerCharacter map={mapInstance} lat={activeLocation?.lat ?? QUEST_LAT} lng={activeLocation?.lng ?? QUEST_LNG} />}

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
