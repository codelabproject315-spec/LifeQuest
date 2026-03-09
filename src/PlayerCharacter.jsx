import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import * as maplibregl from 'maplibre-gl';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const PlayerCharacter = ({ map, lat, lng, bearing }) => {
  const vrmRef = useRef(null);
  const clockRef = useRef(new THREE.Clock());
  const latRef = useRef(lat);
  const lngRef = useRef(lng);
  const bearingRef = useRef(bearing);
  const headingRef = useRef(0);

  // propsが変わるたびにrefを更新 & 進行方向を計算
  useEffect(() => {
    const dLat = lat - latRef.current;
    const dLng = lng - lngRef.current;
    if (Math.abs(dLat) > 0.000001 || Math.abs(dLng) > 0.000001) {
      headingRef.current = Math.atan2(dLng, dLat);
    }
    latRef.current = lat;
    lngRef.current = lng;
    bearingRef.current = bearing;
  }, [lat, lng, bearing]);

  useEffect(() => {
    if (!map) return;

    const vrmLayer = {
      id: 'vrm-player-layer',
      type: 'custom',
      renderingMode: '3d',

      onAdd: function (map, gl) {
        this.camera = new THREE.PerspectiveCamera();
        this.scene = new THREE.Scene();

        const light = new THREE.DirectionalLight(0xffffff, 1.0);
        light.position.set(0, -1, 1).normalize();
        this.scene.add(light);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));

        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));

        console.log('[VRM] 読み込み開始');
        loader.load(
          '/model.vrm',
          (gltf) => {
            console.log('[VRM] 読み込み成功');
            const vrm = gltf.userData.vrm;
            VRMUtils.rotateVRM0(vrm);
            this.scene.add(vrm.scene);
            vrmRef.current = vrm;
            vrm.scene.scale.set(15, 15, 15);
            vrm.scene.rotation.x = Math.PI / 2;
          },
          (progress) => {
            if (progress.total > 0) console.log('[VRM] 進捗:', Math.round(progress.loaded / progress.total * 100) + '%');
          },
          (error) => {
            console.error('[VRM] 読み込みエラー:', error);
          }
        );

        this.renderer = new THREE.WebGLRenderer({
          canvas: map.getCanvas(),
          context: gl,
          antialias: true
        });
        this.renderer.autoClear = false;
      },

      render: function (gl, matrix) {
        if (!vrmRef.current) return;

        // 進行方向 + bearingでキャラの向きを決定
        const bearingRad = -(bearingRef.current ?? 0) * (Math.PI / 180);
        vrmRef.current.scene.rotation.z = headingRef.current + bearingRad;

        // 緯度経度 → メルカトル座標変換
        const mc = maplibregl.MercatorCoordinate.fromLngLat(
          { lng: lngRef.current ?? 0, lat: latRef.current ?? 0 }, 0
        );
        const scale = mc.meterInMercatorCoordinateUnits();
        const modelMatrix = new THREE.Matrix4()
          .makeTranslation(mc.x, mc.y, mc.z)
          .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
          .scale(new THREE.Vector3(scale * 1, -scale * 1, scale * 1));

        const m = new THREE.Matrix4().fromArray(matrix);
        this.camera.projectionMatrix = m.multiply(modelMatrix);

        // アニメーション更新
        const delta = clockRef.current.getDelta();
        const elapsed = clockRef.current.elapsedTime;
        vrmRef.current.update(delta);
        const humanoid = vrmRef.current.humanoid;
        if (humanoid) {
          const t = elapsed * 2.5;
          const armSwing = Math.sin(t) * 0.5;
          const legSwing = Math.sin(t) * 0.4;
          const bodyBob = Math.abs(Math.sin(t)) * 0.03;

          const lUA = humanoid.getNormalizedBoneNode('leftUpperArm');
          const rUA = humanoid.getNormalizedBoneNode('rightUpperArm');
          if (lUA) { lUA.rotation.z = -Math.PI * 1.5; lUA.rotation.x = -armSwing; }
          if (rUA) { rUA.rotation.z =  Math.PI * 1.5; rUA.rotation.x =  armSwing; }

          const lUL = humanoid.getNormalizedBoneNode('leftUpperLeg');
          const rUL = humanoid.getNormalizedBoneNode('rightUpperLeg');
          const lLL = humanoid.getNormalizedBoneNode('leftLowerLeg');
          const rLL = humanoid.getNormalizedBoneNode('rightLowerLeg');
          if (lUL) lUL.rotation.x = legSwing;
          if (rUL) rUL.rotation.x = -legSwing;
          if (lLL) lLL.rotation.x = Math.max(0, -legSwing) * 0.5;
          if (rLL) rLL.rotation.x = Math.max(0, legSwing) * 0.5;

          const spine = humanoid.getNormalizedBoneNode('spine');
          if (spine) spine.rotation.z = Math.sin(t) * 0.05;

          const hips = humanoid.getNormalizedBoneNode('hips');
          if (hips) hips.position.y = bodyBob;
        }

        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
        map.triggerRepaint();
      }
    };

    // 既存レイヤーを削除してから追加（再マウント対策）
    if (map.getLayer('vrm-player-layer')) {
      map.removeLayer('vrm-player-layer');
    }
    map.addLayer(vrmLayer);

    return () => {
      if (map.getLayer('vrm-player-layer')) {
        map.removeLayer('vrm-player-layer');
      }
    };
  }, [map]);

  return null;
};

export default PlayerCharacter;
