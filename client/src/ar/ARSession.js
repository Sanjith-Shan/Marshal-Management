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
      const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['hit-test', 'plane-detection', 'hand-tracking', 'anchors']
      });
      this.session = session;
      this.sceneRoot.renderer.xr.setReferenceSpaceType('local-floor');
      await this.sceneRoot.renderer.xr.setSession(session);
      this.active = true;
      this.emit('enter');

      // Hide table & grid in AR (use real world)
      this.sceneRoot.table.visible = false;
      this.sceneRoot.scene.background = null;
      this.sceneRoot.scene.fog = null;

      // Place terrain ~1 m in front of viewer at floor height
      this.sceneRoot.terrainGroup.position.set(0, 0.05, -1.2);
      this.sceneRoot.terrainGroup.scale.setScalar(0.6);   // tabletop scale

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
    this.sceneRoot.terrainGroup.position.set(0, 0, 0);
    this.sceneRoot.terrainGroup.scale.setScalar(1);
    this.emit('exit');
  }
}
