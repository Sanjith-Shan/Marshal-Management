// ARSession — request immersive-ar with passthrough on Quest 3. If unsupported
// (i.e. the user is on desktop), the button is disabled. The terrain is
// anchored at a fixed offset (0, 1.0, -0.7) at scale 0.35 — RATK plane
// detection / anchors aren't integrated yet (BUILD_LOG Tier B4).
//
// WebXR session bring-up sequence (the order matters):
//   1) Flip the renderer to AR-mode style (transparent clear, no tone-mapping,
//      no fog) — done BEFORE setSession so the first compositor frame is
//      clean and passthrough doesn't flash dark.
//   2) Try a session with the conservative feature set we actually support;
//      if creation fails (Horizon OS rejects dom-overlay or local-floor),
//      retry with progressively fewer features.
//   3) Listen for the 'end' event BEFORE setSession so we never miss a
//      session that ends mid-bring-up.
//   4) Set the reference space, then setSession. Three.js takes over the
//      animation loop from this point.
//   5) Reposition the terrain group for AR.

import * as THREE from 'three';
import { EventEmitter } from '../utils/EventEmitter.js';

export class ARSession extends EventEmitter {
  constructor(sceneRoot, canvas) {
    super();
    this.sceneRoot = sceneRoot;
    this.canvas = canvas;
    this.active = false;
    this.session = null;
    this._enterInFlight = false;     // debounce rapid Enter-AR clicks

    this._checkSupport();
  }

  async _checkSupport() {
    const btn = document.getElementById('btn-xr');
    if (!btn) return;
    if (!('xr' in navigator)) {
      btn.title = 'WebXR not available — desktop mode only';
      btn.classList.add('disabled');
      return;
    }
    if (!window.isSecureContext) {
      btn.title = 'AR requires HTTPS — use https://… on Quest';
      btn.classList.add('disabled');
      return;
    }
    try {
      const supported = await navigator.xr.isSessionSupported('immersive-ar');
      if (!supported) {
        btn.title = 'AR session unsupported on this device — desktop mode active';
        btn.classList.add('disabled');
      } else {
        btn.title = 'Enter immersive AR (requires user gesture)';
      }
    } catch (err) {
      console.warn('[ar] support check failed:', err.message);
    }
  }

  async enter() {
    if (this.active) {
      try { await this.session?.end(); } catch (_) { /* already ending */ }
      return;
    }
    if (this._enterInFlight) return;
    this._enterInFlight = true;

    if (!('xr' in navigator)) {
      alert('WebXR is not available in this browser. Use Quest Browser on Quest 3.');
      this._enterInFlight = false;
      return;
    }
    if (!window.isSecureContext) {
      alert('AR requires HTTPS. Reload over https://… (the dev:quest script enables it).');
      this._enterInFlight = false;
      return;
    }

    // Step 1: flip renderer style BEFORE asking for a session, so the very
    // first XR frame composites cleanly against passthrough.
    this.sceneRoot.setRenderMode(true);

    try {
      const session = await this._requestSessionWithFallback();
      this.session = session;

      // Step 3: register 'end' listener BEFORE setSession so we never miss
      // a session that ends during bring-up (e.g. user removes headset).
      session.addEventListener('end', () => this._onEnd());

      // Step 4: pick the reference space the session actually granted.
      // Three.js will request whichever we name; on Quest, local-floor is
      // standard but `local` is the safe fallback if the floor isn't known.
      const refSpace = await this._tryReferenceSpace(session);
      this.sceneRoot.renderer.xr.setReferenceSpaceType(refSpace);
      await this.sceneRoot.renderer.xr.setSession(session);
      this.active = true;
      this.emit('enter');

      // Step 5: place the terrain at "tabletop" — 1.0 m above the floor,
      // 0.7 m in front of the user. Scale 0.35 makes the 11-unit-wide
      // TerrainMesh fit a ~4 m virtual table. Once RATK plane detection
      // ships (BUILD_LOG Tier B4), this becomes a real anchor.
      this.sceneRoot.terrainGroup.position.set(0, 1.0, -0.7);
      this.sceneRoot.terrainGroup.scale.setScalar(0.35);
      console.log('[ar] entered, reference space =', refSpace);
    } catch (err) {
      console.warn('[ar] requestSession failed:', err);
      const msg = err?.message || String(err);
      // Reset render mode so desktop view returns cleanly.
      this.sceneRoot.setRenderMode(false);
      alert(`Could not start AR: ${msg}`);
    } finally {
      this._enterInFlight = false;
    }
  }

  // Try the richest supported feature set first, then drop features one by
  // one if the session fails. Quest browsers reject sessions that name a
  // required feature they can't honor — so we keep `requiredFeatures` minimal
  // and rely on `optionalFeatures` for the nice-to-haves.
  async _requestSessionWithFallback() {
    const xr = navigator.xr;
    const attempts = [
      // Best case: full optional set + dom-overlay for the HUD.
      {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['hit-test', 'plane-detection', 'hand-tracking', 'anchors', 'dom-overlay'],
        domOverlay: { root: document.body },
      },
      // No dom-overlay — some Horizon OS builds reject it on self-signed origins.
      {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['hit-test', 'plane-detection', 'hand-tracking', 'anchors'],
      },
      // Drop local-floor → local. local-floor needs a known floor; if guardian
      // isn't set up the session can fail. local is the universal fallback.
      {
        requiredFeatures: [],
        optionalFeatures: ['local-floor', 'local', 'hit-test'],
      },
    ];
    let lastErr;
    for (const init of attempts) {
      try {
        const s = await xr.requestSession('immersive-ar', init);
        console.log('[ar] session granted with', JSON.stringify({
          required: init.requiredFeatures,
          optional: init.optionalFeatures,
          domOverlay: !!init.domOverlay,
        }));
        return s;
      } catch (err) {
        lastErr = err;
        console.warn('[ar] session attempt failed:', err.message, '— retrying with fewer features');
      }
    }
    throw lastErr || new Error('All AR session configurations failed');
  }

  // Pick a reference space the active session can honor. Tries local-floor
  // first (proper standing height); falls back to local (head-relative).
  async _tryReferenceSpace(session) {
    try {
      await session.requestReferenceSpace('local-floor');
      return 'local-floor';
    } catch (err) {
      console.warn('[ar] local-floor not available, falling back to local:', err.message);
      return 'local';
    }
  }

  _onEnd() {
    this.active = false;
    this.session = null;
    this.sceneRoot.setRenderMode(false);
    this.sceneRoot.terrainGroup.position.set(0, 0, 0);
    this.sceneRoot.terrainGroup.scale.setScalar(1);
    this.emit('exit');
  }
}
