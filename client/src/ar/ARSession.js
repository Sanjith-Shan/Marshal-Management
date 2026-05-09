// ARSession — request immersive-ar with passthrough on Quest 3. If unsupported
// (i.e. the user is on desktop), the button is disabled. Plane detection is
// best-effort; if no plane is detected within 5 seconds we anchor the terrain
// at the user's feet level on first frame.

import * as THREE from 'three';
import { EventEmitter } from '../utils/EventEmitter.js';

export class ARSession extends EventEmitter {
  constructor(sceneRoot, canvas) {
    super();
    this.sceneRoot = sceneRoot;
    this.canvas = canvas;
    this.active = false;
    this.session = null;
    this.referenceSpace = null;
    this.hitTestSource = null;

    this._checkSupport();
  }

  async _checkSupport() {
    const btn = document.getElementById('btn-xr');
    if (!('xr' in navigator)) {
      btn.title = 'WebXR not available — desktop mode only';
      btn.classList.add('disabled');
      return;
    }
    try {
      const supported = await navigator.xr.isSessionSupported('immersive-ar');
      if (!supported) {
        btn.title = 'AR session unsupported on this device — desktop mode active';
        btn.classList.add('disabled');
      }
    } catch (err) {
      console.warn('[ar] support check failed:', err.message);
    }
  }

  async enter() {
    if (this.active) {
      await this.session?.end();
      return;
    }
    if (!('xr' in navigator)) {
      alert('WebXR is not available in this browser. Use Quest Browser or Chromium 79+ on Quest 3.');
      return;
    }
    try {
      // dom-overlay puts the HUD/panels on top of the AR scene so the
      // marshal can still read modes, scenarios, and advisor messages
      // while in immersive passthrough. Without it, the entire DOM is
      // hidden during the XR session and the user sees only the WebGL
      // scene + passthrough.
      const sessionInit = {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['hit-test', 'plane-detection', 'hand-tracking', 'anchors', 'dom-overlay'],
        domOverlay: { root: document.body }
      };
      console.log('[ar] requesting immersive-ar with dom-overlay');
      const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
      this.session = session;
      this.sceneRoot.renderer.xr.setReferenceSpaceType('local-floor');
      await this.sceneRoot.renderer.xr.setSession(session);
      this.active = true;
      this.emit('enter');

      // Hide desktop-only props + force the renderer to clear with full
      // transparency so the AR compositor shows passthrough where the
      // scene has no geometry (otherwise the compositor sees an opaque
      // black canvas and the user gets the "everything is black" bug).
      this.sceneRoot.table.visible = false;
      this.sceneRoot.scene.background = null;
      this.sceneRoot.scene.fog = null;
      this.sceneRoot.renderer.setClearColor(0x000000, 0);

      // Anchor the terrain at "tabletop" height — 1.0 m above the floor,
      // 0.7 m in front of the user's start position. Standing user looks
      // down ~30° to see it; can crouch / sit / walk around it. Scale
      // 0.35 makes the 11-unit-wide TerrainMesh fit a ~4 m virtual table.
      this.sceneRoot.terrainGroup.position.set(0, 1.0, -0.7);
      this.sceneRoot.terrainGroup.scale.setScalar(0.35);
      console.log('[ar] terrain placed at (0, 1.0, -0.7) scale 0.35');

      session.addEventListener('end', () => this._onEnd());
    } catch (err) {
      console.warn('[ar] requestSession failed:', err.message);
      alert(`Could not start AR: ${err.message}`);
    }
  }

  _onEnd() {
    this.active = false;
    this.session = null;
    this.sceneRoot.table.visible = true;
    this.sceneRoot.scene.background = new THREE.Color('#070a10');
    this.sceneRoot.scene.fog = new THREE.Fog('#070a10', 18, 50);
    this.sceneRoot.renderer.setClearColor(0x070a10, 1);
    this.sceneRoot.terrainGroup.position.set(0, 0, 0);
    this.sceneRoot.terrainGroup.scale.setScalar(1);
    this.emit('exit');
  }
}
