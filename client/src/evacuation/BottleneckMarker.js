// BottleneckMarker — orange pulsing rings at the midpoint of any edge
// flagged as a bottleneck (flow > 80% capacity).

import * as THREE from 'three';

export class BottleneckMarker {
  constructor(scenario, terrain) {
    this.scenario = scenario;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'bottlenecks';
    this.markers = [];
    this._lastSnap = null;
  }

  applySnapshot(snap) {
    this._lastSnap = snap;
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    this.markers = [];
    if (!snap?.evacuation?.bottlenecks) return;
    for (const b of snap.evacuation.bottlenecks) {
      const e = this.scenario.edges.find(x => x.id === b.edgeId);
      if (!e) continue;
      const A = this.scenario.nodes[e.u], B = this.scenario.nodes[e.v];
      const mid = this.terrain.gridToWorld(
        (A.x + B.x) / 2, (A.z + B.z) / 2, 0.05
      );
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.05, 0.085, 24),
        new THREE.MeshBasicMaterial({
          color: 0xffa040, transparent: true, opacity: 0.85,
          side: THREE.DoubleSide, depthWrite: false
        })
      );
      ring.position.copy(mid);
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 7;
      this.group.add(ring);
      this.markers.push({ ring, ratio: b.ratio });
    }
  }

  update(dt) {
    const t = performance.now() / 400;
    for (const m of this.markers) {
      const s = 1 + 0.25 * Math.sin(t);
      m.ring.scale.setScalar(s);
      m.ring.material.opacity = 0.55 + 0.4 * Math.abs(Math.sin(t));
    }
  }
}
