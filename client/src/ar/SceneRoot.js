// SceneRoot — Three.js renderer, scene, and camera. The terrain group is
// what we anchor in AR (parented to a plane anchor when entering immersive),
// and what desktop OrbitControls operates on.

import * as THREE from 'three';

export class SceneRoot {
  constructor() {
    this.canvas = document.getElementById('three-canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.xr.enabled = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#070a10');
    this.scene.fog = new THREE.Fog('#070a10', 18, 50);

    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.05,
      400
    );
    this.camera.position.set(0, 6, 9);
    this.camera.lookAt(0, 0, 0);

    // Lights
    const hemi = new THREE.HemisphereLight(0xa8c8ff, 0x1a1410, 0.45);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe4b8, 1.1);
    sun.position.set(6, 12, 4);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x6cb8ff, 0.35);
    rim.position.set(-8, 6, -8);
    this.scene.add(rim);

    // Terrain group is what we anchor / scale.
    this.terrainGroup = new THREE.Group();
    this.terrainGroup.name = 'terrain-group';
    // Scale the world (24 km in scenario coords) down to ~6 m wide tabletop
    this.terrainGroup.scale.setScalar(1);     // we render in scene units; 1 unit ≈ 1 m
    this.scene.add(this.terrainGroup);

    // A subtle "table" disk under the terrain in desktop mode
    this.table = new THREE.Mesh(
      new THREE.CircleGeometry(8, 64),
      new THREE.MeshStandardMaterial({
        color: 0x0a0e16, roughness: 0.95, metalness: 0.0
      })
    );
    this.table.rotation.x = -Math.PI / 2;
    this.table.position.y = -0.02;
    this.scene.add(this.table);

    // Faint grid for orientation
    const grid = new THREE.GridHelper(16, 16, 0x1a3a5a, 0x0a1a2a);
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    grid.position.y = -0.015;
    this.scene.add(grid);

    this.clock = new THREE.Clock();

    window.addEventListener('resize', () => this._onResize());
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    // Hook for any per-frame scene updates (light flicker, etc.)
  }
}
