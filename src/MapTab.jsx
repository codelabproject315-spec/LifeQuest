import React, { useEffect, useRef, useState } from 'react';
import { Navigation, X, CheckCircle2, Zap, MapPin, Camera, Loader2 } from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import PlayerCharacter from './PlayerCharacter.jsx';
import { getFirestore, collection, addDoc, getDocs, query, orderBy, limit } from 'firebase/firestore';

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

// ── カメラオーバーレイ ────────────────────────────────────────
const CameraOverlay = ({ isOpen, onClose, onCapture }) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [camError, setCamError] = useState('');
  const [facingMode, setFacingMode] = useState('environment');

  useEffect(() => { if (isOpen) startCamera(facingMode); return stopCamera; }, [isOpen]);

  const startCamera = async (mode) => {
    setCamError('');
    setIsReady(false);
    streamRef.current?.getTracks().forEach(t => t.stop());
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode } });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        videoRef.current.onloadedmetadata = () => { videoRef.current.play(); setIsReady(true); };
      }
    } catch { setCamError('カメラへのアクセスが拒否されました。'); }
  };
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setIsReady(false);
    setCamError('');
  };
  const handleClose = () => { stopCamera(); onClose(); };
  const handleFlip = () => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    startCamera(next);
  };
  const handleCapture = () => {
    const canvas = document.createElement('canvas');
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    // インカメは左右反転して保存
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    const base64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
    stopCamera();
    onCapture(base64);
  };

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[300] bg-black flex flex-col">
      {camError ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
          <p className="text-white font-bold text-center">{camError}</p>
          <button type="button" onClick={handleClose} className="px-8 py-4 bg-white text-slate-900 rounded-2xl font-black">閉じる</button>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="flex-1 w-full h-full object-cover"
            style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
          />
          <div className="absolute inset-0 flex flex-col justify-between p-6 pointer-events-none">
            <div className="flex items-center justify-between pointer-events-auto">
              <button type="button" onClick={handleClose} className="p-3 bg-black/40 text-white rounded-full active:scale-90 transition-transform">
                <X size={24} />
              </button>
              <button type="button" onClick={handleFlip} className="p-3 bg-black/40 text-white rounded-full active:scale-90 transition-transform">
                <Camera size={24} />
              </button>
            </div>
            <div className="flex flex-col items-center gap-4 pointer-events-auto mb-12">
              <div className="text-white text-xs font-bold bg-black/50 px-4 py-2 rounded-full border border-white/20">
                📍 この場所の写真を撮ってください
              </div>
              <button
                type="button"
                onClick={handleCapture}
                disabled={!isReady}
                className="w-20 h-20 bg-white rounded-full border-4 border-slate-300 active:scale-90 transition-transform shadow-2xl disabled:opacity-50"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ── POI訪問モーダル（写真撮影 → 投稿） ───────────────────────
const POIVisitModal = ({ poi, currentUser, db, appId, onComplete, onClose }) => {
  const [step, setStep] = useState('intro');   // intro | camera | preview | posting | done
  const [capturedImage, setCapturedImage] = useState(null);
  const [caption, setCaption] = useState('');
  const xp = poi.xp ?? 20;
  const info = POI_LABELS[poi.poiType] ?? POI_LABELS.mall;

  const handleCapture = (base64) => {
    setCapturedImage(base64);
    setStep('preview');
  };

  const handlePost = async () => {
    setStep('posting');
    try {
      const col = collection(db, 'artifacts', appId, 'public', 'data', 'poi_photos');
      await addDoc(col, {
        userId: currentUser.id,
        userName: currentUser.name,
        userAvatar: currentUser.avatar,
        poiName: poi.name || info.label,
        poiType: poi.poiType,
        poiLat: poi.lat,
        poiLng: poi.lng,
        imageBase64: capturedImage,
        caption: caption.trim(),
        xp,
        createdAt: Date.now(),
      });
    } catch (e) {
      console.warn('[POI POST] 投稿失敗:', e);
    }
    setStep('done');
    setTimeout(() => {
      onComplete(poi);
      onClose();
    }, 1400);
  };

  return (
    <>
      <CameraOverlay
        isOpen={step === 'camera'}
        onClose={() => setStep('intro')}
        onCapture={handleCapture}
      />

      {step !== 'camera' && (
        <div
          className="fixed inset-0 z-[200] flex items-end justify-center"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <div className="w-full max-w-md bg-white rounded-t-3xl p-6 pb-28 shadow-2xl">

            {/* ヘッダー */}
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

            {/* XP表示 */}
            <div className="flex items-center gap-1 mb-4 text-amber-500 font-black text-sm">
              <Zap size={14} /><span>+{xp} XP</span>
            </div>

            {/* intro: 写真を撮るボタン */}
            {step === 'intro' && (
              <button
                type="button"
                onClick={() => setStep('camera')}
                className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-base active:scale-95 transition-all flex items-center justify-center gap-2 shadow-lg"
              >
                <Camera size={20} />写真を撮って投稿する
              </button>
            )}

            {/* preview: 撮った写真の確認・キャプション入力 */}
            {step === 'preview' && capturedImage && (
              <div>
                <img
                  src={`data:image/jpeg;base64,${capturedImage}`}
                  className="w-full rounded-2xl object-cover mb-3"
                  style={{ maxHeight: 200 }}
                  alt="撮影した写真"
                />
                <input
                  type="text"
                  placeholder="ひとこと添えよう（任意）"
                  value={caption}
                  onChange={e => setCaption(e.target.value)}
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-400 mb-3"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStep('camera')}
                    className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-black text-sm active:scale-95 transition-all"
                  >
                    撮り直す
                  </button>
                  <button
                    type="button"
                    onClick={handlePost}
                    className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-black text-sm active:scale-95 transition-all flex items-center justify-center gap-1"
                  >
                    <CheckCircle2 size={16} />投稿する
                  </button>
                </div>
              </div>
            )}

            {/* posting */}
            {step === 'posting' && (
              <div className="w-full py-4 bg-indigo-50 text-indigo-600 rounded-2xl font-black flex items-center justify-center gap-2">
                <Loader2 size={18} className="animate-spin" />投稿中...
              </div>
            )}

            {/* done */}
            {step === 'done' && (
              <div className="w-full py-4 bg-emerald-500 text-white rounded-2xl font-black flex items-center justify-center gap-2">
                <CheckCircle2 size={18} />投稿完了！ +{xp} XP 🎉
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

// ── MapTab ───────────────────────────────────────────────────
const MapTab = ({ quests, userLocation, gpsStatus, mockOffset, setMockOffset, QUEST_LAT, QUEST_LNG, onQuestComplete, currentUser, db, appId }) => {
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const mapInstanceRef = useRef(null);
  const [mapInstance, setMapInstance] = useState(null);
  const [selectedPOI, setSelectedPOI] = useState(null);
  const [poiList, setPOIList] = useState([]);
  const [pinPositions, setPinPositions] = useState([]);

  const setSelectedPOIRef = useRef(null);
  setSelectedPOIRef.current = setSelectedPOI;
  const setPOIListRef = useRef(null);
  setPOIListRef.current = setPOIList;

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

      // 手動操作したら追従を永久にオフ（現在地ボタンで手動復帰）
      const onInteractStart = () => { userIsInteractingRef.current = true; };
      map.on('dragstart', onInteractStart);
      map.on('touchstart', onInteractStart);

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

        const poiDataList = [];
        data.elements.forEach(el => {
          const elLat = el.lat ?? el.center?.lat;
          const elLng = el.lon ?? el.center?.lon;
          if (!elLat || !elLng) return;
          const poiType = getPOIType(el.tags);
          poiDataList.push({
            poiType,
            name: el.tags?.name ?? null,
            lat: elLat,
            lng: elLng,
            xp: (poiType === 'park' || poiType === 'garden') ? 15 : 10,
          });
        });

        setPOIListRef.current(poiDataList);
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

  // 毎フレームPOIの画面座標を再計算
  useEffect(() => {
    if (!mapInstance || poiList.length === 0) return;
    const update = () => {
      setPinPositions(poiList.map(poi => {
        const p = mapInstance.project([poi.lng, poi.lat]);
        return { ...poi, x: p.x, y: p.y };
      }));
    };
    update();
    mapInstance.on('render', update);
    return () => mapInstance.off('render', update);
  }, [mapInstance, poiList]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* POIピンオーバーレイ */}
      {pinPositions.map((poi, i) => {
        const info = POI_LABELS[poi.poiType] ?? POI_LABELS.mall;
        return (
          <div
            key={i}
            onClick={() => setSelectedPOI(poi)}
            style={{
              position: 'absolute',
              left: poi.x - 20,
              top: poi.y - 48,
              width: 40,
              height: 48,
              cursor: 'pointer',
              zIndex: 10,
            }}
          >
            {poi.name && (
              <div style={{
                position: 'absolute', top: -20, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: 10, fontWeight: 'bold',
                whiteSpace: 'nowrap', padding: '2px 5px', borderRadius: 4, pointerEvents: 'none',
              }}>{poi.name}</div>
            )}
            <div style={{
              width: 36, height: 36, background: info.color, border: '3px solid white',
              borderRadius: '50% 50% 50% 0', transform: 'rotate(-45deg)',
              boxShadow: '0 3px 8px rgba(0,0,0,0.35)', position: 'absolute', top: 0, left: 2,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{ transform: 'rotate(45deg)', fontSize: 17, pointerEvents: 'none' }}>
                {info.emoji}
              </div>
            </div>
            <div style={{
              width: 0, height: 0,
              borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
              borderTop: `8px solid ${info.color}`,
              position: 'absolute', bottom: 2, left: 13, pointerEvents: 'none',
            }} />
          </div>
        );
      })}

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
        onClick={() => {
          userIsInteractingRef.current = false;
          activeLocation && mapInstance?.easeTo({
            center: [activeLocation.lng, activeLocation.lat],
            zoom: MAP_ZOOM, pitch: MAP_PITCH, offset: [0, 80], duration: 600,
          });
        }}
        style={{
          position: 'absolute', bottom: 180, right: 12, zIndex: 500,
          background: 'white', borderRadius: '50%', width: 44, height: 44,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)', border: 'none', cursor: 'pointer',
        }}
      >
        <Navigation size={20} color="#4f46e5" />
      </button>

      {/* POI訪問モーダル */}
      {selectedPOI && (
        <POIVisitModal
          poi={selectedPOI}
          currentUser={currentUser}
          db={db}
          appId={appId}
          onComplete={(poi) => onQuestComplete?.(poi)}
          onClose={() => setSelectedPOI(null)}
        />
      )}
    </div>
  );
};

export default MapTab;
