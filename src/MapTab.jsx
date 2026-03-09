import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Navigation, Zap, X, MapPin } from 'lucide-react';

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

// 緯度経度 → 3Dワールド座標
const latLngToWorld = (lat, lng, originLat, originLng) => {
  const x = (lng - originLng) * Math.cos((originLat * Math.PI) / 180) * 111320;
  const z = -(lat - originLat) * 111320;
  return { x, z };
};

const RANK_CONFIG = {
  S: { color: 0xf59e0b, emissive: 0xf59e0b, emoji: '👑', label: 'S', height: 1.8 },
  A: { color: 0x8b5cf6, emissive: 0x8b5cf6, emoji: '⚡', label: 'A', height: 1.5 },
  B: { color: 0x3b82f6, emissive: 0x3b82f6, emoji: '🔵', label: 'B', height: 1.2 },
  C: { color: 0x10b981, emissive: 0x10b981, emoji: '🟢', label: 'C', height: 1.0 },
  D: { color: 0x6b7280, emissive: 0x6b7280, emoji: '⚪', label: 'D', height: 0.8 },
};

const MapTab = ({ quests, userLocation, gpsStatus, mockOffset, setMockOffset, QUEST_LAT, QUEST_LNG }) => {
  const canvasRef = useRef(null);
  const threeRef = useRef({});
  const animFrameRef = useRef(null);
  const [selectedQuest, setSelectedQuest] = useState(null);
  const [threeReady, setThreeReady] = useState(false);

  const locationQuests = quests.filter(q => q.type === 'location');
  const mockLocation = { lat: QUEST_LAT + (mockOffset / 111000), lng: QUEST_LNG };
  const mockDist = calculateDistance(mockLocation.lat, mockLocation.lng, QUEST_LAT, QUEST_LNG);
  const activeLocation = userLocation || (gpsStatus === 'mock' ? mockLocation : null);

  // Three.js初期化
  useEffect(() => {
    const initThree = (THREE) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const W = window.innerWidth;
      const H = window.innerHeight;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x7dd3fc);
      scene.fog = new THREE.FogExp2(0x87ceeb, 0.007);

      const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 800);
      camera.position.set(0, 32, 28);
      camera.lookAt(0, 0, 0);

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setSize(W, H);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;

      // 光源
      scene.add(new THREE.AmbientLight(0xffffff, 0.65));
      const sun = new THREE.DirectionalLight(0xfffde7, 1.3);
      sun.position.set(30, 50, 20);
      sun.castShadow = true;
      sun.shadow.mapSize.width = 1024;
      sun.shadow.mapSize.height = 1024;
      sun.shadow.camera.near = 0.5;
      sun.shadow.camera.far = 300;
      sun.shadow.camera.left = -100;
      sun.shadow.camera.right = 100;
      sun.shadow.camera.top = 100;
      sun.shadow.camera.bottom = -100;
      scene.add(sun);

      // 地面
      const groundGeo = new THREE.PlaneGeometry(400, 400, 50, 50);
      const posArr = groundGeo.attributes.position;
      for (let i = 0; i < posArr.count; i++) {
        const x = posArr.getX(i), z = posArr.getZ(i);
        posArr.setY(i, Math.sin(x * 0.04) * 0.4 + Math.cos(z * 0.04) * 0.4);
      }
      groundGeo.computeVertexNormals();
      const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ color: 0x86efac }));
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);

      // 道路
      const roadMat = new THREE.MeshLambertMaterial({ color: 0xd1d5db });
      const addRoad = (x, z, w, d) => {
        const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), roadMat);
        r.position.set(x, 0.03, z);
        r.receiveShadow = true;
        scene.add(r);
      };
      [-60, -30, 0, 30, 60].forEach(z => addRoad(0, z, 400, 5));
      [-60, -30, 0, 30, 60].forEach(x => addRoad(x, 0, 5, 400));

      // 建物
      const bColors = [0xbfdbfe, 0xddd6fe, 0xfce7f3, 0xd1fae5, 0xfef3c7, 0xe0e7ff, 0xffedd5];
      const rng = s => { let v = Math.sin(s * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
      let s = 0;
      for (let gx = -4; gx <= 4; gx++) {
        for (let gz = -4; gz <= 4; gz++) {
          if (Math.abs(gx * 30) < 4 || Math.abs(gz * 30) < 4) continue;
          const bx = gx * 30 + (rng(s++) - 0.5) * 12;
          const bz = gz * 30 + (rng(s++) - 0.5) * 12;
          const bw = 5 + rng(s++) * 9;
          const bh = 3 + rng(s++) * 14;
          const bd = 5 + rng(s++) * 9;
          const color = bColors[Math.floor(rng(s++) * bColors.length)];
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(bw, bh, bd),
            new THREE.MeshLambertMaterial({ color })
          );
          mesh.position.set(bx, bh / 2, bz);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          scene.add(mesh);
          const roof = new THREE.Mesh(
            new THREE.ConeGeometry(Math.max(bw, bd) * 0.72, 2.5, 4),
            new THREE.MeshLambertMaterial({ color: 0xef4444 })
          );
          roof.position.set(bx, bh + 1.2, bz);
          roof.rotation.y = Math.PI / 4;
          roof.castShadow = true;
          scene.add(roof);
        }
      }

      // 木
      for (let i = 0; i < 50; i++) {
        const tx = (rng(s++) - 0.5) * 250, tz = (rng(s++) - 0.5) * 250;
        const th = 2.5 + rng(s++) * 3;
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.2, 0.3, th, 6),
          new THREE.MeshLambertMaterial({ color: 0x92400e })
        );
        trunk.position.set(tx, th / 2, tz);
        trunk.castShadow = true;
        scene.add(trunk);
        const leaf = new THREE.Mesh(
          new THREE.SphereGeometry(1.3 + rng(s++) * 0.8, 8, 6),
          new THREE.MeshLambertMaterial({ color: 0x16a34a })
        );
        leaf.position.set(tx, th + 1.1, tz);
        leaf.castShadow = true;
        scene.add(leaf);
      }

      // プレイヤー
      const playerGroup = new THREE.Group();
      const addPart = (geo, color, px, py, pz, rx = 0, rz = 0) => {
        const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
        m.position.set(px, py, pz);
        m.rotation.x = rx; m.rotation.z = rz;
        m.castShadow = true;
        playerGroup.add(m);
        return m;
      };
      addPart(new THREE.CylinderGeometry(0.42, 0.52, 1.3, 8), 0x6366f1, 0, 0.65, 0);
      const head = addPart(new THREE.SphereGeometry(0.46, 12, 10), 0xfbbf24, 0, 1.65, 0);
      addPart(new THREE.CylinderGeometry(0.37, 0.52, 0.42, 8), 0xdc2626, 0, 2.0, 0);
      addPart(new THREE.CylinderGeometry(0.67, 0.67, 0.09, 8), 0xdc2626, 0, 1.82, 0);
      const armL = addPart(new THREE.CylinderGeometry(0.15, 0.15, 0.85, 6), 0x6366f1, -0.67, 0.82, 0, 0, 0.4);
      const armR = addPart(new THREE.CylinderGeometry(0.15, 0.15, 0.85, 6), 0x6366f1, 0.67, 0.82, 0, 0, -0.4);
      const legL = addPart(new THREE.CylinderGeometry(0.18, 0.15, 0.85, 6), 0x1e40af, -0.23, 0.0, 0);
      const legR = addPart(new THREE.CylinderGeometry(0.18, 0.15, 0.85, 6), 0x1e40af, 0.23, 0.0, 0);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.1, 0.09, 8, 32),
        new THREE.MeshBasicMaterial({ color: 0x818cf8, transparent: true, opacity: 0.7 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.1;
      playerGroup.add(ring);
      playerGroup.position.set(0, 0, 0);
      scene.add(playerGroup);

      // 雲
      const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.88 });
      for (let i = 0; i < 15; i++) {
        const cg = new THREE.Group();
        const cx = (rng(s++) - 0.5) * 350, cz = (rng(s++) - 0.5) * 350;
        for (let j = 0; j < 5; j++) {
          const c = new THREE.Mesh(new THREE.SphereGeometry(3 + rng(s++) * 3, 7, 5), cloudMat);
          c.position.set((rng(s++) - 0.5) * 8, (rng(s++) - 0.5) * 2, (rng(s++) - 0.5) * 5);
          cg.add(c);
        }
        cg.position.set(cx, 65 + rng(s++) * 20, cz);
        scene.add(cg);
      }

      const questObjects = [];

      const onResize = () => {
        const w = window.innerWidth, h = window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener('resize', onResize);

      threeRef.current = { scene, camera, renderer, playerGroup, questObjects, ring, armL, armR, legL, legR, THREE };
      setThreeReady(true);

      let t = 0;
      const animate = () => {
        animFrameRef.current = requestAnimationFrame(animate);
        t += 0.018;

        playerGroup.position.y = Math.sin(t * 2) * 0.09;
        ring.rotation.z = t;
        ring.material.opacity = 0.35 + Math.sin(t * 3) * 0.3;
        armL.rotation.z = 0.4 + Math.sin(t * 4) * 0.22;
        armR.rotation.z = -(0.4 + Math.sin(t * 4 + Math.PI) * 0.22);
        legL.rotation.x = Math.sin(t * 4) * 0.22;
        legR.rotation.x = Math.sin(t * 4 + Math.PI) * 0.22;

        questObjects.forEach((obj, i) => {
          obj.group.position.y = obj.baseY + Math.sin(t * 2 + i * 1.2) * 0.35;
          obj.group.rotation.y = t * 0.7;
          obj.ring.material.opacity = 0.25 + Math.sin(t * 3 + i) * 0.2;
          obj.ring.scale.setScalar(1 + Math.sin(t * 2 + i) * 0.18);
        });

        const px = playerGroup.position.x, pz = playerGroup.position.z;
        camera.position.set(px, 32, pz + 28);
        camera.lookAt(px, 0, pz);

        renderer.render(scene, camera);
      };
      animate();

      return () => { window.removeEventListener('resize', onResize); };
    };

    if (window.THREE) { initThree(window.THREE); return; }
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    sc.onload = () => initThree(window.THREE);
    document.head.appendChild(sc);

    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, []);

  // プレイヤー位置更新
  useEffect(() => {
    if (!threeReady || !threeRef.current.playerGroup) return;
    const loc = userLocation || mockLocation;
    const { x, z } = latLngToWorld(loc.lat, loc.lng, QUEST_LAT, QUEST_LNG);
    const pg = threeRef.current.playerGroup;
    pg.position.x += (x - pg.position.x) * 0.12;
    pg.position.z += (z - pg.position.z) * 0.12;
  });

  // クエストオブジェクト更新
  useEffect(() => {
    if (!threeReady || !threeRef.current.scene) return;
    const { scene, questObjects, THREE } = threeRef.current;
    questObjects.forEach(obj => scene.remove(obj.group));
    questObjects.length = 0;
    const loc = activeLocation || { lat: QUEST_LAT, lng: QUEST_LNG };

    locationQuests.forEach((q) => {
      if (!q.lat || !q.lng) return;
      const { x, z } = latLngToWorld(q.lat, q.lng, QUEST_LAT, QUEST_LNG);
      const dist = calculateDistance(loc.lat, loc.lng, q.lat, q.lng);
      const unlocked = dist <= q.radius;
      const rank = q.rank || 'D';
      const cfg = RANK_CONFIG[rank] || RANK_CONFIG.D;

      const group = new THREE.Group();
      group.position.set(x, 0, z);

      const baseMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(1.6, 1.9, 0.32, 16),
        new THREE.MeshLambertMaterial({ color: unlocked ? cfg.color : 0x9ca3af, transparent: true, opacity: 0.9 })
      );
      baseMesh.position.y = 0.16;
      baseMesh.castShadow = true;
      group.add(baseMesh);

      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.72, cfg.height * 2, 8),
        new THREE.MeshLambertMaterial({ color: unlocked ? cfg.color : 0x6b7280 })
      );
      tower.position.y = cfg.height;
      tower.castShadow = true;
      group.add(tower);

      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.65),
        new THREE.MeshLambertMaterial({
          color: unlocked ? cfg.color : 0x9ca3af,
          emissive: unlocked ? cfg.emissive : 0x333333,
          emissiveIntensity: unlocked ? 0.45 : 0.1,
        })
      );
      gem.position.y = cfg.height * 2 + 0.75;
      gem.castShadow = true;
      group.add(gem);

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.9, 0.11, 8, 32),
        new THREE.MeshBasicMaterial({ color: unlocked ? cfg.color : 0x9ca3af, transparent: true, opacity: 0.5 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.32;
      group.add(ring);

      const circle = new THREE.Mesh(
        new THREE.RingGeometry(q.radius / 10 - 0.4, q.radius / 10, 64),
        new THREE.MeshBasicMaterial({ color: unlocked ? cfg.color : 0x9ca3af, transparent: true, opacity: 0.18, side: THREE.DoubleSide })
      );
      circle.rotation.x = -Math.PI / 2;
      circle.position.y = 0.06;
      group.add(circle);

      scene.add(group);
      questObjects.push({ group, ring, gem, baseY: cfg.height, quest: q });
    });

    threeRef.current.questObjects = questObjects;
  }, [quests, userLocation, mockOffset, threeReady]);

  // レイキャスト（タップでクエスト選択）
  const handleCanvasClick = useCallback((e) => {
    if (!threeReady || !threeRef.current.scene) return;
    const { camera, questObjects, THREE } = threeRef.current;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    const mouse = new THREE.Vector2(
      ((cx - rect.left) / rect.width) * 2 - 1,
      -((cy - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const allMeshes = questObjects.flatMap(o => o.group.children);
    const hits = raycaster.intersectObjects(allMeshes);
    if (hits.length > 0) {
      const found = questObjects.find(o => o.group.children.includes(hits[0].object));
      if (found) setSelectedQuest(found.quest);
    }
  }, [threeReady]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100 }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
        onClick={handleCanvasClick}
        onTouchEnd={handleCanvasClick}
      />

      {/* ヘッダーHUD */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '14px 16px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.65), transparent)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', pointerEvents: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ fontSize: 24 }}>🗺️</span>
          <div>
            <div style={{ color: 'white', fontWeight: 900, fontSize: 17, textShadow: '0 2px 6px rgba(0,0,0,0.6)' }}>クエストマップ</div>
            <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700 }}>{locationQuests.length}個のクエストが近くにある</div>
          </div>
        </div>
        <div style={{ background: gpsStatus === 'ok' ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)', border: `1px solid ${gpsStatus === 'ok' ? '#10b981' : '#f59e0b'}`, borderRadius: 20, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 5, backdropFilter: 'blur(8px)' }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: gpsStatus === 'ok' ? '#10b981' : '#f59e0b', boxShadow: `0 0 8px ${gpsStatus === 'ok' ? '#10b981' : '#f59e0b'}` }} />
          <span style={{ color: 'white', fontSize: 11, fontWeight: 900 }}>{gpsStatus === 'ok' ? 'GPS接続中' : 'デモモード'}</span>
        </div>
      </div>

      {/* デモスライダー */}
      {gpsStatus === 'mock' && (
        <div style={{ position: 'absolute', top: 70, left: 12, right: 12, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(14px)', borderRadius: 14, padding: '10px 14px', border: '1px solid rgba(251,191,36,0.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <MapPin size={12} color="#fbbf24" />
            <span style={{ color: '#fbbf24', fontSize: 11, fontWeight: 900 }}>デモ位置を移動</span>
            <span style={{ marginLeft: 'auto', color: mockDist <= 200 ? '#10b981' : '#94a3b8', fontSize: 11, fontWeight: 900 }}>{mockDist <= 200 ? '🔓 解放！' : formatDistance(mockDist)}</span>
          </div>
          <input type="range" min={0} max={800} step={10} value={mockOffset} onChange={e => setMockOffset(Number(e.target.value))} style={{ width: '100%', accentColor: '#818cf8' }} />
        </div>
      )}

      {/* クエスト横スクロール */}
      {locationQuests.length > 0 && !selectedQuest && (
        <div style={{ position: 'absolute', bottom: 100, left: 0, right: 0, padding: '0 12px' }}>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
            {locationQuests.map(q => {
              const dist = activeLocation ? calculateDistance(activeLocation.lat, activeLocation.lng, q.lat, q.lng) : null;
              const unlocked = dist !== null && dist <= q.radius;
              const cfg = RANK_CONFIG[q.rank || 'D'] || RANK_CONFIG.D;
              const colorHex = '#' + cfg.color.toString(16).padStart(6, '0');
              return (
                <button key={q.id} onClick={() => setSelectedQuest(q)} style={{ flexShrink: 0, background: unlocked ? `linear-gradient(135deg,${colorHex}44,rgba(0,0,0,0.65))` : 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)', border: `1.5px solid ${unlocked ? colorHex + '88' : 'rgba(255,255,255,0.1)'}`, borderRadius: 14, padding: '9px 13px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minWidth: 160 }}>
                  <span style={{ fontSize: 20 }}>{cfg.emoji}</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ color: 'white', fontWeight: 900, fontSize: 11, whiteSpace: 'nowrap', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.title}</div>
                    <div style={{ color: unlocked ? '#10b981' : '#94a3b8', fontSize: 10, fontWeight: 700 }}>{unlocked ? '✅ 範囲内' : `📏 ${formatDistance(dist)}`}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* クエスト詳細 */}
      {selectedQuest && (() => {
        const q = selectedQuest;
        const dist = activeLocation ? calculateDistance(activeLocation.lat, activeLocation.lng, q.lat, q.lng) : null;
        const unlocked = dist !== null && dist <= q.radius;
        const cfg = RANK_CONFIG[q.rank || 'D'] || RANK_CONFIG.D;
        const colorHex = '#' + cfg.color.toString(16).padStart(6, '0');
        return (
          <div style={{ position: 'absolute', bottom: 100, left: 12, right: 12, background: 'rgba(10,10,25,0.92)', backdropFilter: 'blur(20px)', borderRadius: 22, border: `1.5px solid ${colorHex}55`, padding: 18, boxShadow: `0 12px 40px ${colorHex}33` }}>
            <button onClick={() => setSelectedQuest(null)} style={{ position: 'absolute', top: 13, right: 13, background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%', width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <X size={15} color="white" />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 11 }}>
              <div style={{ width: 46, height: 46, borderRadius: 13, background: colorHex + '33', border: `2px solid ${colorHex}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>{cfg.emoji}</div>
              <div>
                <div style={{ color: colorHex, fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{q.rank || 'D'}ランク</div>
                <div style={{ color: 'white', fontWeight: 900, fontSize: 15 }}>{q.title}</div>
              </div>
            </div>
            {q.description && <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, marginBottom: 11 }}>{q.description}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: unlocked ? '#10b981' : '#f59e0b', fontWeight: 900, fontSize: 13 }}>{unlocked ? '✅ 範囲内 — クリアできる！' : `📏 あと ${formatDistance(Math.max(0, dist - q.radius))}`}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#fbbf24', fontWeight: 900, fontSize: 14 }}><Zap size={14} />+{q.xp} XP</div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default MapTab;
