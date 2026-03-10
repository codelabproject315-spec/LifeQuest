import React, { useEffect, useRef, useState } from 'react';
import { Navigation, X, CheckCircle2, Zap, MapPin } from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import PlayerCharacter from './PlayerCharacter.jsx';

const MAP_ZOOM = 18;
const MAP_PITCH = 85;

const POI_LABELS = {
  park:        { label: '公園',              emoji: '🌳', color: '#5a9e6f' },
  garden:      { label: 'ガーデン',          emoji: '🌸', color: '#5a9e6f' },
  mall:        { label: 'ショッピングモール', emoji: '🏬', color: '#e8734a' },
  supermarket: { label: 'スーパー',          emoji: '🛒', color: '#e8734a' },
  school:      { label: '学校',              emoji: '🏫', color: '#6a9bd4' },
  hospital:    { label: '病院',              emoji: '🏥', color: '#e85a5a' },
};

const getPOIType = (tags) => {
  if (tags?.leisure === 'park')       return 'park';
  if (tags?.leisure === 'garden')     return 'garden';
  if (tags?.shop === 'mall')          return 'mall';
  if (tags?.shop === 'supermarket')   return 'supermarket';
  if (tags?.amenity === 'school')     return 'school';
  if (tags?.amenity === 'hospital')   return 'hospital';
  return 'mall';
};

// ── POIクエスト完了モーダル ──────────────────────────────────
const POIQuestModal = ({ poi, onComplete, onClose }) => {
  const [status, setStatus] = useState('idle');
  const xp = poi.xp ?? 20;
  const info = POI_LABELS[poi.poiType] ?? POI_LABELS.mall;

  const handleComplete = () => {
    setStatus('done');
    setTimeout(() => {
      onComplete(poi);
      onClose();
    }, 1400);
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-white rounded-t-3xl p-6 pb-28 shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shadow"
              style={{ background: info.color + '22', border: `2px solid ${info.color}` }}
            >
              {info.emoji}
            </div>
            <div className="text-left">
              <span
                className="text-[10px] font-black px-2 py-0.5 rounded-full mb-1 inline-block"
                style={{ background: info.color + '22', color: info.color }}
              >
                {info.label}
              </span>
              <h2 className="font-black text-lg text-slate-800 leading-tight">
                {poi.name || info.label + 'を訪問'}
              </h2>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-full bg-slate-100 text-slate-400 active:scale-90 transition-transform">
            <X size={18} />
          </button>
        </div>

        <div className="bg-slate-50 rounded-2xl px-4 py-3 mb-4 flex items-center gap-2 text-left">
          <MapPin size={14} className="text-slate-400 shrink-0" />
          <p className="text-xs text-slate-500 font-bold">
            {poi.name ? `${poi.name} に到着しました` : 'このスポットに到着しました'}
          </p>
        </div>

        <div className="border-2 border-indigo-100 rounded-2xl p-4 mb-5 text-left bg-indigo-50/50">
          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-wider mb-1">📍 位置クエスト</p>
          <p className="font-bold text-sm text-slate-700">{info.label}エリアに足を運ぶ</p>
          <div className="flex items-center gap-1 mt-2 text-amber-500 font-black text-sm">
            <Zap size={14} /><span>+{xp} XP</span>
          </div>
        </div>

        {status === 'idle' && (
          <button type="button" onClick={handleComplete} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-base active:scale-95 transition-all flex items-center justify-center gap-2 shadow-lg">
            <CheckCircle2 size={20} />クエストを完了する
          </button>
        )}
        {status === 'done' && (
          <div className="w-full py-4 bg-emerald-500 text-white rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-lg">
            <CheckCircle2 size={20} />達成認定！ +{xp} XP 🎉
          </div>
        )}
      </div>
    </div>
  );
};

// ── MapTab ───────────────────────────────────────────────────
const MapTab = ({ quests, userLocation, gpsStatus, mockOffset, setMockOffset, QUEST_LAT, QUEST_LNG, onQuestComplete }) => {
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const mapInstanceRef = useRef(null);
  const [mapInstance, setMapInstance] = useState(null);
  const [selectedPOI, setSelectedPOI] = useState(null);

  const setSelectedPOIRef = useRef(null);
  setSelectedPOIRef.current = setSelectedPOI;

  // ユーザーが手動操作中は追従しない
  const userIsInteractingRef = useRef(false);
  const interactingTimerRef = useRef(null);

  const activeLocation = userLocation || (gpsStatus === 'mock'
    ? { lat: QUEST_LAT + (mockOffset / 111000), lng: QUEST_LNG }
    : null);
  const activeLocationRef = useRef(activeLocation);
  useEffect(() => { activeLocationRef.current = activeLocation; }, [activeLocation]);

  useEffect(() => {
    if (mapInstanceRef.current) return;

    const initLng = activeLocationRef.current?.lng ?? QUEST_LNG;
    const initLat = activeLocationRef.current?.lat ?? QUEST_LAT;

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: 'https://tiles.basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [initLng, initLat],
      zoom: MAP_ZOOM,
      pitch: MAP_PITCH,
      bearing: 0,
      antialias: true,
    });
    mapInstanceRef.current = map;

    map.on('load', () => {
      console.log('[MAP LOADED]');

      const loc = activeLocationRef.current;
      if (loc) map.jumpTo({ center: [loc.lng, loc.lat], zoom: MAP_ZOOM, pitch: MAP_PITCH });

      const repaintInterval = setInterval(() => map.triggerRepaint(), 16);
      map._repaintInterval = repaintInterval;
      setMapInstance(map);

      // 手動操作の検知（ドラッグ・ピンチ・スクロール）
      const onInteractStart = () => {
        userIsInteractingRef.current = true;
        if (interactingTimerRef.current) clearTimeout(interactingTimerRef.current);
      };
      const onInteractEnd = () => {
        // 操作終了から3秒後に追従を再開
        interactingTimerRef.current = setTimeout(() => {
          userIsInteractingRef.current = false;
        }, 3000);
      };
      map.on('dragstart', onInteractStart);
      map.on('touchstart', onInteractStart);
      map.on('dragend', onInteractEnd);
      map.on('touchend', onInteractEnd);

      // ── POI取得 ──────────────────────────────────────────
      const poiLat = activeLocationRef.current?.lat ?? QUEST_LAT;
      const poiLng = activeLocationRef.current?.lng ?? QUEST_LNG;

      (async () => {
        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];

        const radius = 1000;
        const query = `
          [out:json][timeout:25];
          (
            node["leisure"="park"](around:${radius},${poiLat},${poiLng});
            node["leisure"="garden"](around:${radius},${poiLat},${poiLng});
            node["shop"="mall"](around:${radius},${poiLat},${poiLng});
            node["shop"="supermarket"](around:${radius},${poiLat},${poiLng});
            node["amenity"="school"](around:${radius},${poiLat},${poiLng});
            node["amenity"="hospital"](around:${radius},${poiLat},${poiLng});
            way["leisure"="park"](around:${radius},${poiLat},${poiLng});
            way["landuse"="park"](around:${radius},${poiLat},${poiLng});
            way["shop"="mall"](around:${radius},${poiLat},${poiLng});
          );
          out center 20;
        `;

        let data = null;
        try {
          console.log('[POI] fetch開始 lat:', poiLat, 'lng:', poiLng);
          const res = await fetch('https://maps.mail.ru/osm/tools/overpass/api/interpreter', {
            method: 'POST', body: query, signal: AbortSignal.timeout(15000),
          });
          data = await res.json();
          console.log('[POI] 取得件数:', data.elements?.length);
        } catch (e) {
          console.warn('[POI] fetch失敗:', e.message);
        }

        if (!data) return;

        data.elements.forEach(el => {
          const elLat = el.lat ?? el.center?.lat;
          const elLng = el.lon ?? el.center?.lon;
          if (!elLat || !elLng) return;

          const poiType = getPOIType(el.tags);
          const info = POI_LABELS[poiType];

          // ピンのDOM（pointer-events:noneでMapLibreに触らせない）
          const wrapper = document.createElement('div');
          wrapper.style.cssText = `
            width: 40px;
            height: 48px;
            position: relative;
            pointer-events: none;
            user-select: none;
            -webkit-user-select: none;
          `;

          const pinEl = document.createElement('div');
          pinEl.style.cssText = `
            width: 36px;
            height: 36px;
            background: ${info.color};
            border: 3px solid white;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            transform-origin: center center;
            box-shadow: 0 3px 8px rgba(0,0,0,0.35);
            position: absolute;
            top: 0;
            left: 2px;
          `;

          const inner = document.createElement('div');
          inner.style.cssText = `
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            transform: rotate(45deg);
            font-size: 17px;
          `;
          inner.textContent = info.emoji;
          pinEl.appendChild(inner);

          const tip = document.createElement('div');
          tip.style.cssText = `
            width: 0;
            height: 0;
            border-left: 5px solid transparent;
            border-right: 5px solid transparent;
            border-top: 8px solid ${info.color};
            position: absolute;
            bottom: 2px;
            left: 13px;
          `;

          wrapper.appendChild(pinEl);
          wrapper.appendChild(tip);

          // マップのclickイベントでピン付近をタップ検知
          map.on('click', (e) => {
            const markerPos = map.project([elLng, elLat]);
            const clickPos = e.point;
            const dist = Math.sqrt(
              Math.pow(markerPos.x - clickPos.x, 2) +
              Math.pow(markerPos.y - clickPos.y, 2)
            );
            if (dist < 30) {
              setSelectedPOIRef.current({
                poiType,
                name: el.tags?.name ?? null,
                lat: elLat,
                lng: elLng,
                xp: (poiType === 'park' || poiType === 'garden') ? 15 : 10,
              });
            }
          });

          const marker = new maplibregl.Marker({
            element: wrapper,
            draggable: false,
            anchor: 'bottom',
          })
            .setLngLat([elLng, elLat])
            .addTo(map);

          console.log('[POI] マーカー追加:', elLng, elLat);
          markersRef.current.push(marker);
        });
      })();
      // ── POI取得ここまで ──────────────────────────────────

      // 3D建物
      const sources = map.getStyle().sources;
      const buildingSource = Object.keys(sources).find(k => sources[k].type === 'vector') ?? 'openmaptiles';
      try {
        map.addLayer({
          id: '3d-buildings', source: buildingSource, 'source-layer': 'building',
          type: 'fill-extrusion', minzoom: 15,
          paint: { 'fill-extrusion-color': '#7ecfcf', 'fill-extrusion-height': ['get', 'render_height'] }
        });
      } catch (e) { console.warn('3d-buildings error:', e); }
      try {
        map.addLayer({
          id: 'building-outline', source: buildingSource, 'source-layer': 'building',
          type: 'line', minzoom: 15,
          paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': 0.8 }
        });
      } catch (e) { console.warn('building-outline error:', e); }

      // ポケGoっぽい色設定
      const paintMap = {
        'background':            [['background-color', '#b8e4e0']],
        'landcover':             [['fill-color', '#b8e4e0']],
        'landuse':               [['fill-color', '#6db87f']],
        'landuse_residential':   [['fill-color', '#c8e8c0']],
        'park_national_park':    [['fill-color', '#5a9e6f']],
        'park_nature_reserve':   [['fill-color', '#5a9e6f']],
        'water':                 [['fill-color', '#4ab8d4']],
        'road_service_fill':     [['line-color', '#a8a89e'], ['line-width', ['interpolate',['exponential',1.5],['zoom'],10,1,17,30]]],
        'road_minor_fill':       [['line-color', '#a8a89e'], ['line-width', ['interpolate',['exponential',1.5],['zoom'],10,2,17,30]]],
        'road_sec_fill_noramp':  [['line-color', '#a8a89e'], ['line-width', ['interpolate',['exponential',1.5],['zoom'],10,3,17,30]]],
        'road_pri_fill_noramp':  [['line-color', '#a8a89e'], ['line-width', ['interpolate',['exponential',1.5],['zoom'],10,4,17,30]]],
        'road_trunk_fill_noramp':[['line-color', '#a8a89e'], ['line-width', ['interpolate',['exponential',1.5],['zoom'],10,4,17,30]]],
        'road_mot_fill_noramp':  [['line-color', '#a8a89e'], ['line-width', ['interpolate',['exponential',1.5],['zoom'],10,5,17,30]]],
        'road_service_case':     [['line-color', '#e8c97a'], ['line-width', ['interpolate',['exponential',1.5],['zoom'],10,2,17,40]]],
        'road_minor_case':       [['line-color', '#e8c97a'], ['line-width', ['interpolate',['exponential',1.5],['zoom'],10,3,17,40]]],
        'road_sec_case_noramp':  [['line-color', '#e8c97a'], ['line-width', ['interpolate',['exponential',1.5],['zoom'],10,4,17,40]]],
        'road_pri_case_noramp':  [['line-color', '#e8c97a'], ['line-width', ['interpolate',['exponential',1.5],['zoom'],10,5,17,40]]],
        'road_trunk_case_noramp':[['line-color', '#e8c97a'], ['line-width', ['interpolate',['exponential',1.5],['zoom'],10,5,17,40]]],
        'road_mot_case_noramp':  [['line-color', '#e8c97a'], ['line-width', ['interpolate',['exponential',1.5],['zoom'],10,6,17,40]]],
        'building':              [['fill-color', '#9edede'], ['fill-outline-color', '#4ab3b3']],
        'building-top':          [['fill-color', '#7ecfcf'], ['fill-outline-color', '#4ab3b3']],
      };
      Object.entries(paintMap).forEach(([id, props]) => {
        props.forEach(([prop, val]) => {
          try { map.setPaintProperty(id, prop, val); } catch(e) {}
        });
      });
    });

    return () => {
      if (map._repaintInterval) clearInterval(map._repaintInterval);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // カメラ追従
  useEffect(() => {
    if (mapInstance && activeLocation && !userIsInteractingRef.current) {
      mapInstance.easeTo({
        center: [activeLocation.lng, activeLocation.lat],
        zoom: MAP_ZOOM,
        pitch: MAP_PITCH,
        offset: [0, 80],
        duration: 800,
        easing: (t) => t,
      });
    }
  }, [activeLocation, mapInstance]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {mapInstance && (
        <PlayerCharacter
          map={mapInstance}
          lat={activeLocation?.lat ?? QUEST_LAT}
          lng={activeLocation?.lng ?? QUEST_LNG}
          bearing={mapInstance.getBearing()}
        />
      )}

      {/* 現在地ボタン */}
      <button
        onClick={() => activeLocation && mapInstance?.easeTo({
          center: [activeLocation.lng, activeLocation.lat],
          zoom: MAP_ZOOM,
          pitch: MAP_PITCH,
          offset: [0, 80],
          duration: 600,
        })}
        style={{
          position: 'absolute', bottom: 180, right: 12, zIndex: 500,
          background: 'white', borderRadius: '50%', width: 44, height: 44,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)', border: 'none', cursor: 'pointer',
        }}
      >
        <Navigation size={20} color="#4f46e5" />
      </button>

      {/* POIクエスト完了モーダル */}
      {selectedPOI && (
        <POIQuestModal
          poi={selectedPOI}
          onComplete={(poi) => onQuestComplete?.(poi)}
          onClose={() => setSelectedPOI(null)}
        />
      )}
    </div>
  );
};

export default MapTab;
