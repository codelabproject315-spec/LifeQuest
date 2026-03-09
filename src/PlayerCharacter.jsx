import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import * as maplibregl from 'maplibre-gl';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const PlayerCharacter = ({ map, lat, lng }) => {
  const vrmRef = useRef(null);
  const mixerRef = useRef(null);
  const clockRef = useRef(new THREE.Clock());

  useEffect(() => {
    if (!map) return;

    const vrmLayer = {
      id: 'vrm-player-layer',
      type: 'custom',
      renderingMode: '3d',
      onAdd: function (map, gl) {
        this.camera = new THREE.PerspectiveCamera();
        this.scene = new THREE.Scene();

        // ライティング
        const light = new THREE.DirectionalLight(0xffffff, 1.0);
        light.position.set(0, -1, 1).normalize();
        this.scene.add(light);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));

        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));

        loader.load('/model.vrm', (gltf) => {
          const vrm = gltf.userData.vrm;
          VRMUtils.rotateVRM0(vrm);
          this.scene.add(vrm.scene);
          vrmRef.current = vrm;

          // モデルのサイズ調整（地図のスケールに合わせる）
          vrm.scene.scale.set(15, 15, 15);
          vrm.scene.rotation.x = Math.PI / 2; // 立たせる
          
          // ここで着せ替えやポーズの初期設定が可能
        });

        this.renderer = new THREE.WebGLRenderer({
          canvas: map.getCanvas(),
          context: gl,
          antialias: true
        });
        this.renderer.autoClear = false;
      },
      render: function (gl, matrix) {
        if (!vrmRef.current) return;

        // ✅ 緯度経度をMapLibreのメルカトル座標に変換してモデルを正しい位置に配置
        const mc = maplibregl.MercatorCoordinate.fromLngLat({ lng: lng ?? 0, lat: lat ?? 0 }, 0);
        const scale = mc.meterInMercatorCoordinateUnits();
        const modelMatrix = new THREE.Matrix4()
          .makeTranslation(mc.x, mc.y, mc.z)
          .scale(new THREE.Vector3(scale * 2, -scale * 2, scale * 2));

        const m = new THREE.Matrix4().fromArray(matrix);
        this.camera.projectionMatrix = m.multiply(modelMatrix);
        
        // アニメーションの更新（将来用）
        const delta = clockRef.current.getDelta();
        if (vrmRef.current) {
          vrmRef.current.update(delta);
        }

        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
        map.triggerRepaint();
      }
    };

    map.addLayer(vrmLayer);

    return () => {
      if (map.getLayer('vrm-player-layer')) {
        map.removeLayer('vrm-player-layer');
      }
    };
  }, [map]);

  return null; // このコンポーネントはDOMを出さない
};

export default PlayerCharacter;
