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
    this._evacMode = false;
  }

  setEvacMode(active) {
    this._evacMode = active;
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

      // Small floating label above the ring showing capacity %, hwy class
      const pct = Math.round(b.ratio * 100);
      const label = this._makeLabel(`${pct}% · ${e.hwy}`, mid);
      this.group.add(label);

      this.markers.push({ ring, label, ratio: b.ratio });
    }
  }

  _makeLabel(text, pos) {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(30,20,10,0.75)';
    ctx.beginPath();
    ctx.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 6);
    ctx.fill();
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#ffa040';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    const tex = new THREE.CanvasTexture(canvas);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.32, 0.08),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide })
    );
    mesh.position.set(pos.x, pos.y + 0.1, pos.z);
    mesh.renderOrder = 9;
    return mesh;
  }

  update(dt, camera) {
    const t = performance.now() / 400;
    const em = this._evacMode;
    for (const m of this.markers) {
      // In evacuate mode: larger rings, higher base opacity, faster pulse
      const period = em ? 250 : 400;
      const baseScale = em ? 1.4 : 1.0;
      const s = baseScale * (1 + 0.30 * Math.sin(performance.now() / period));
      m.ring.scale.setScalar(s);
      m.ring.material.opacity = em
        ? 0.75 + 0.25 * Math.abs(Math.sin(performance.now() / period))
        : 0.55 + 0.4 * Math.abs(Math.sin(t));
      if (m.label && camera) m.label.lookAt(camera.position);
    }
  }
}
