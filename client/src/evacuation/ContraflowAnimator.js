// ContraflowAnimator — renders directional chevron arrows on every edge
// with the contra flag set. The arrows flow from u → v (toward shelter side)
// to communicate "this road is now one-way outbound."
//
// Implementation: per contra edge, a small ribbon of points cycling along the
// edge midline. Color is cyan (matches the road-line contraflow color).

import * as THREE from 'three';

const CHEVRONS_PER_EDGE = 6;
const FLOW_SPEED = 0.45;        // world units per second
const LIFT = 0.045;

export class ContraflowAnimator {
  constructor(scenario, terrain) {
    this.scenario = scenario;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'contraflow';
    this.entries = new Map();   // edgeId -> { points, geom, count, len, A, B }
    this._evacMode = false;
    this._currentEdges = new Set();
  }

  setEvacMode(active) {
    this._evacMode = active;
    for (const e of this.entries.values()) {
      e.points.material.size    = active ? 0.06 : 0.045;
      e.points.material.opacity = active ? 1.0 : 0.85;
    }
  }

  // Sync renderer with the snapshot's contraflow edge IDs.
  applySnapshot(snap) {
    const contraIds = new Set(snap?.edgeContraflowIds || []);
    // Remove entries no longer contraflowing
    for (const id of [...this.entries.keys()]) {
      if (!contraIds.has(id)) {
        const rec = this.entries.get(id);
        this.group.remove(rec.points);
        rec.geom.dispose();
        rec.points.material.dispose();
        this.entries.delete(id);
      }
    }
    // Add entries newly contraflowing
    for (const id of contraIds) {
      if (this.entries.has(id)) continue;
      this._addEdge(id);
    }
    this._currentEdges = contraIds;
  }

  _addEdge(edgeId) {
    const e = this.scenario.edges.find(ed => ed.id === edgeId);
    if (!e) return;
    const A = this.scenario.nodes[e.u];
    const B = this.scenario.nodes[e.v];
    const pA = this.terrain.gridToWorld(A.x, A.z, LIFT);
    const pB = this.terrain.gridToWorld(B.x, B.z, LIFT);
    const len = pA.distanceTo(pB);

    const positions = new Float32Array(CHEVRONS_PER_EDGE * 3);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x66e0ff,
      size: this._evacMode ? 0.06 : 0.045,
      transparent: true,
      opacity: this._evacMode ? 1.0 : 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const points = new THREE.Points(geom, mat);
    points.renderOrder = 6;
    this.group.add(points);

    this.entries.set(edgeId, {
      points, geom,
      positions,
      A: pA, B: pB,
      len,
      count: CHEVRONS_PER_EDGE
    });
  }

  update(dt) {
    const tNow = performance.now() / 1000;
    for (const rec of this.entries.values()) {
      const { A, B, len, count, positions, geom } = rec;
      // Each chevron rides a phase along the edge; phases evenly spaced.
      const lap = ((tNow * FLOW_SPEED) / Math.max(0.01, len)) % 1;
      for (let i = 0; i < count; i++) {
        const phase = (i / count + lap) % 1;
        positions[i * 3 + 0] = A.x + (B.x - A.x) * phase;
        positions[i * 3 + 1] = A.y + (B.y - A.y) * phase + 0.005 * Math.sin(tNow * 6 + i);
        positions[i * 3 + 2] = A.z + (B.z - A.z) * phase;
      }
      geom.attributes.position.needsUpdate = true;
    }
  }
}
