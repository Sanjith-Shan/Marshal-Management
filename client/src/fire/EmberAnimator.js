// EmberAnimator — minimal arc-particle visualization of ember-spotting
// events. When the CA's wind-driven spotting code lands a remote spot
// fire, a single small warm-orange particle arcs from the source cell to
// the landing cell over ~1.2 seconds and fades. Capped at 25 active
// embers so a wind shift that triggers many spot fires at once doesn't
// flood the scene. Subtle by design — meant to communicate that wind is
// pushing fire ahead of the perimeter, not to dominate the visual.

import * as THREE from 'three';

const MAX_ACTIVE   = 25;
const LIFETIME_MS  = 1200;
const ARC_HEIGHT   = 0.4;     // peak arc height in scene units
const SIZE         = 0.07;
const COLOR        = 0xffa844;

export class EmberAnimator {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'embers';

    // Fixed-size Points pool. Inactive slots park positions far below the
    // scene so they're invisible without needing per-particle alpha.
    this._positions = new Float32Array(MAX_ACTIVE * 3);
    for (let i = 0; i < MAX_ACTIVE; i++) this._positions[i * 3 + 1] = -1000;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(this._positions, 3));

    const mat = new THREE.PointsMaterial({
      color: COLOR,
      size: SIZE,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geom, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    this.group.add(this.points);

    this._active = [];                                // { fromW, toW, slot, startTime }
    this._freeSlots = [];
    for (let i = MAX_ACTIVE - 1; i >= 0; i--) this._freeSlots.push(i);
  }

  // Spawn one arc from source grid coord to landing grid coord.
  spawn(fromGrid, toGrid) {
    if (!this._freeSlots.length) return;
    const fromW = this.terrain.gridToWorld(fromGrid.gx, fromGrid.gy, 0.06);
    const toW   = this.terrain.gridToWorld(toGrid.gx,   toGrid.gy,   0.06);
    const slot = this._freeSlots.pop();
    this._active.push({ fromW, toW, slot, startTime: performance.now() });
  }

  update(dt) {
    if (!this._active.length) return;
    const now = performance.now();
    const remaining = [];
    for (const e of this._active) {
      const age = now - e.startTime;
      if (age >= LIFETIME_MS) {
        // Park slot below scene + reclaim
        this._positions[e.slot * 3 + 0] = 0;
        this._positions[e.slot * 3 + 1] = -1000;
        this._positions[e.slot * 3 + 2] = 0;
        this._freeSlots.push(e.slot);
        continue;
      }
      const t = age / LIFETIME_MS;
      // Linear horizontal interp; parabolic vertical lift peaking at t=0.5
      const x = e.fromW.x + (e.toW.x - e.fromW.x) * t;
      const z = e.fromW.z + (e.toW.z - e.fromW.z) * t;
      const yBase = e.fromW.y + (e.toW.y - e.fromW.y) * t;
      const lift = ARC_HEIGHT * 4 * t * (1 - t);
      this._positions[e.slot * 3 + 0] = x;
      this._positions[e.slot * 3 + 1] = yBase + lift;
      this._positions[e.slot * 3 + 2] = z;
      remaining.push(e);
    }
    this._active = remaining;
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
