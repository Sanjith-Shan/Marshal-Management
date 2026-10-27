// ARSession — request immersive-ar with passthrough on Quest 3 and place the
// terrain on a real surface using WebXR hit-test. The flow:
//   1) Flip the renderer to AR-mode style BEFORE setSession so passthrough
//      composites cleanly (no dark flash).
//   2) Try a session with full features; if rejected, drop features one by
//      one (Horizon OS quirks with self-signed certs).
//   3) Set up a hit-test source from the viewer reference space → reticle
//      mesh tracks any plane the headset is pointed at.
//   4) Each XR frame: update reticle pose. If terrain is "unplaced", live-
//      preview the terrain at the reticle. Controller select (= pinch on
//      hand-tracking, trigger on controllers) locks the terrain there.
//   5) Until hit-test fires, terrain sits at a sensible default offset
//      (table-height in front of the user) so they always see something.

import * as THREE from 'three';
import { EventEmitter } from '../utils/EventEmitter.js';

const DEFAULT_AR_SCALE = 0.12;     // 12 m terrain world × 0.12 ≈ 1.44 m wide
const DEFAULT_AR_POS = new THREE.Vector3(0, 0.74, -0.7); // tabletop-height fallback

export class ARSession extends EventEmitter {
  constructor(sceneRoot, canvas) {
    super();
    this.sceneRoot = sceneRoot;
    this.canvas = canvas;
    this.active = false;
    this.session = null;
    this._enterInFlight = false;     // debounce rapid Enter-AR clicks

    // Hit-test plumbing — populated on enter(), cleared on _onEnd().
    this._hitTestSource = null;
    this._localRefSpace = null;
    this._reticle = null;
    this._placed = false;            // true after user locks terrain in place
    this._controllers = [];

    // The XRPanels handler wired by main.js so we can flip its activation
    // and forward the placement frame.
    this._panels = null;

    this._checkSupport();
  }

  // main.js sets this so we can activate XR-native panels alongside the
  // session and clean them up on exit.
  setPanels(panels) { this._panels = panels; }

  async _checkSupport() {
    const btn = document.getElementById('btn-xr');
    if (!btn) return;
    const setLabel = (txt) => {
      const span = btn.querySelector('span:last-child');
      if (span) span.textContent = txt; else btn.textContent = txt;
    };
    if (!('xr' in navigator)) {
      btn.title = 'WebXR not available — desktop mode only';
      btn.classList.add('disabled');
      setLabel('AR · no webxr');
      return;
    }
    if (!window.isSecureContext) {
      btn.title = 'AR requires HTTPS — use https://… on Quest';
      btn.classList.add('disabled');
      setLabel('AR · http only');
      return;
    }
    try {
      const supported = await navigator.xr.isSessionSupported('immersive-ar');
      if (!supported) {
        btn.title = 'AR session unsupported on this device — desktop mode active';
        // We deliberately leave the button clickable: some Quest browser
        // versions report unsupported until a user gesture but accept
        // requestSession anyway. The label tells the user what's known.
        setLabel('AR · try anyway');
      } else {
        btn.title = 'Enter immersive AR (requires user gesture)';
      }
    } catch (err) {
      console.warn('[ar] support check failed:', err.message);
      setLabel('AR · check err');
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

    this.sceneRoot.setRenderMode(true);

    try {
      const session = await this._requestSessionWithFallback();
      this.session = session;

      session.addEventListener('end', () => this._onEnd());

      const refSpaceName = await this._tryReferenceSpace(session);
      this.sceneRoot.renderer.xr.setReferenceSpaceType(refSpaceName);
      await this.sceneRoot.renderer.xr.setSession(session);
      this.active = true;

      // Cache the local reference space for hit-test pose lookups.
      try {
        this._localRefSpace = await session.requestReferenceSpace(refSpaceName);
      } catch (_) {
        this._localRefSpace = await session.requestReferenceSpace('local');
      }

      // Default placement until hit-test grabs a real surface — a tabletop-
      // height offset in front of the user. If hit-test never fires (older
      // headsets, no plane detected) the user still sees the terrain.
      this.sceneRoot.terrainGroup.position.copy(DEFAULT_AR_POS);
      this.sceneRoot.terrainGroup.scale.setScalar(DEFAULT_AR_SCALE);
      this._placed = false;

      // Hit-test source: queries the world along the headset's forward ray
      // to find the closest detected surface. Optional feature — if Horizon
      // declines it we just skip the reticle and use the default offset.
      try {
        const viewerSpace = await session.requestReferenceSpace('viewer');
        if (typeof session.requestHitTestSource === 'function') {
          this._hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
          console.log('[ar] hit-test source acquired');
        }
      } catch (err) {
        console.warn('[ar] hit-test unavailable:', err.message);
      }

      this._buildReticle();
      this._wireControllers();

      if (this._panels) this._panels.setActive(true);

      this.emit('enter');
      console.log('[ar] entered, reference space =', refSpaceName);
    } catch (err) {
      console.warn('[ar] requestSession failed:', err);
      const msg = err?.message || String(err);
      this.sceneRoot.setRenderMode(false);
      alert(`Could not start AR: ${msg}`);
    } finally {
      this._enterInFlight = false;
    }
  }

  async _requestSessionWithFallback() {
    const xr = navigator.xr;
    const attempts = [
      // Best case: hit-test + plane-detection so we can anchor on real surfaces.
      {
        requiredFeatures: ['local-floor', 'hit-test'],
        optionalFeatures: ['plane-detection', 'hand-tracking', 'anchors', 'dom-overlay'],
        domOverlay: { root: document.body },
      },
      // Drop dom-overlay if Horizon balks at the self-signed origin.
      {
        requiredFeatures: ['local-floor', 'hit-test'],
        optionalFeatures: ['plane-detection', 'hand-tracking', 'anchors'],
      },
      // Drop hit-test → still get AR, just no auto-placement reticle.
      {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['hit-test', 'plane-detection', 'hand-tracking', 'anchors'],
      },
      // Last-ditch: minimal session, fall back to head-relative space.
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

  async _tryReferenceSpace(session) {
    try {
      await session.requestReferenceSpace('local-floor');
      return 'local-floor';
    } catch (err) {
      console.warn('[ar] local-floor not available, falling back to local:', err.message);
      return 'local';
    }
  }

  _buildReticle() {
    const ring = new THREE.RingGeometry(0.10, 0.13, 48).rotateX(-Math.PI / 2);
    const dot = new THREE.CircleGeometry(0.012, 24).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x6cb8ff, transparent: true, opacity: 0.85, depthTest: false,
    });
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0x6cb8ff, transparent: true, opacity: 0.95, depthTest: false,
    });
    const reticle = new THREE.Group();
    reticle.name = 'ar-reticle';
    const ringMesh = new THREE.Mesh(ring, ringMat);
    const dotMesh = new THREE.Mesh(dot, dotMat);
    ringMesh.renderOrder = 999;
    dotMesh.renderOrder = 999;
    reticle.add(ringMesh);
    reticle.add(dotMesh);
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    this.sceneRoot.scene.add(reticle);
    this._reticle = reticle;
  }

  _wireControllers() {
    // Controllers fire 'select' on trigger pull (Quest controllers) OR on
    // pinch (hand tracking). Either way: lock the terrain to the reticle.
    // We listen on both controller slots so left or right hand works.
    const xr = this.sceneRoot.renderer.xr;
    for (let i = 0; i < 2; i++) {
      const c = xr.getController(i);
      const onSelect = () => this._onSelect();
      c.addEventListener('select', onSelect);
      this.sceneRoot.scene.add(c);
      this._controllers.push({ controller: c, onSelect });
    }
  }

  _onSelect() {
    if (!this.active) return;
    if (!this._placed) {
      // Lock terrain at current reticle position.
      this._placed = true;
      if (this._reticle) this._reticle.visible = false;
      console.log('[ar] terrain placement locked');
    } else {
      // Re-enter placement mode — useful if the demo table moved.
      this._placed = false;
      console.log('[ar] re-entering placement mode');
    }
  }

  // Called every XR frame from main.js _frame(). Updates the reticle and,
  // until placement is locked, slaves the terrain to it. This is the only
  // sensible time to call frame.getHitTestResults — the XRFrame is only
  // valid inside its callback.
  updateXRFrame(frame) {
    if (!this.active || !frame) return;
    if (!this._hitTestSource || !this._localRefSpace) return;
    let hits;
    try {
      hits = frame.getHitTestResults(this._hitTestSource);
    } catch (_) {
      return;
    }
    if (!hits || hits.length === 0) {
      if (this._reticle) this._reticle.visible = false;
      return;
    }
    const pose = hits[0].getPose(this._localRefSpace);
    if (!pose) return;

    const reticle = this._reticle;
    if (reticle) {
      reticle.matrix.fromArray(pose.transform.matrix);
      reticle.visible = !this._placed;
    }

    if (!this._placed) {
      // Live-preview: the terrain rides the reticle until the user locks it.
      // We only copy translation — keeping the terrain world-aligned (Y up,
      // North = -Z) is more legible than aligning to surface normals.
      const tg = this.sceneRoot.terrainGroup;
      const m = pose.transform.matrix;
      tg.position.set(m[12], m[13], m[14]);
      tg.scale.setScalar(DEFAULT_AR_SCALE);
    }
  }

  _onEnd() {
    this.active = false;
    this.session = null;
    this.sceneRoot.setRenderMode(false);
    this.sceneRoot.terrainGroup.position.set(0, 0, 0);
    this.sceneRoot.terrainGroup.scale.setScalar(1);

    if (this._reticle) {
      this.sceneRoot.scene.remove(this._reticle);
      this._reticle.children.forEach(m => {
        m.geometry?.dispose();
        m.material?.dispose();
      });
      this._reticle = null;
    }
    if (this._hitTestSource) {
      try { this._hitTestSource.cancel(); } catch (_) {}
      this._hitTestSource = null;
    }
    this._localRefSpace = null;
    for (const { controller, onSelect } of this._controllers) {
      controller.removeEventListener('select', onSelect);
      this.sceneRoot.scene.remove(controller);
    }
    this._controllers = [];
    this._placed = false;
    if (this._panels) this._panels.setActive(false);

    this.emit('exit');
  }
}
