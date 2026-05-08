// PopulationDots — small white dots representing residents at each population
// node. When a zone goes to LEVEL 3 GO, dots animate along its evacuation
// route toward the shelter, then fade.

import * as THREE from 'three';

const DOTS_PER_PERSON = 0.01;     // 100 people = 1 dot
const MIN_DOTS_PER_NODE = 2;
const MAX_DOTS_PER_NODE = 8;

export class PopulationDots {
  constructor(scenario, terrain) {
    this.scenario = scenario;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'populations';
    this.dotsByZone = new Map();  // zoneName -> { positions, geom, points, basePositions, evacuated }
    this._lastSnap = null;
    this._build();
  }

  _build() {
    const byZone = new Map();
    for (const p of this.scenario.populations) {
      if (!byZone.has(p.zone)) byZone.set(p.zone, []);
      byZone.get(p.zone).push(p);
    }
    for (const [zone, pops] of byZone) {
      const positions = [];
      for (const p of pops) {
        const n = this.scenario.nodes[p.nodeId];
        const cnt = Math.min(MAX_DOTS_PER_NODE,
          Math.max(MIN_DOTS_PER_NODE, Math.round(p.count * DOTS_PER_PERSON)));
        for (let i = 0; i < cnt; i++) {
          const jx = n.x + (Math.random() - 0.5) * 1.6;
          const jy = n.z + (Math.random() - 0.5) * 1.6;
          const v = this.terrain.gridToWorld(jx, jy, 0.025);
          positions.push(v.x, v.y, v.z);
        }
      }
      const arr = new Float32Array(positions);
      const base = arr.slice();
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const mat = new THREE.PointsMaterial({
        color: 0xeaf2ff,
        size: 0.022,
        transparent: true,
        opacity: 0.75,
        depthWrite: false
      });
      const pts = new THREE.Points(geom, mat);
      pts.renderOrder = 4;
      this.group.add(pts);
      this.dotsByZone.set(zone, { positions: arr, base, geom, points: pts, level: 1, evacPct: 0 });
    }
  }

  applySnapshot(snap) {
    this._lastSnap = snap;
    if (!snap?.evacuation?.zones) return;
    for (const z of snap.evacuation.zones) {
      const rec = this.dotsByZone.get(z.name);
      if (!rec) continue;
      rec.level = z.level;
      rec.evacPct = z.evacuatedPct || 0;
      rec.points.material.color.setHex(
        z.level === 3 ? 0xfff3a0 : z.level === 2 ? 0xfff8c0 : 0xeaf2ff
      );
    }
  }

  update(dt) {
    const t = performance.now() / 1000;
    for (const rec of this.dotsByZone.values()) {
      // Subtle idle jitter
      const arr = rec.positions;
      const base = rec.base;
      for (let i = 0; i < arr.length; i += 3) {
        const j = (Math.sin(t * 1.6 + i * 0.1) * 0.5 + 0.5) * 0.005;
        arr[i + 1] = base[i + 1] + j;
      }
      // GO zones: linearly fade out a fraction matching evacPct
      const opacity = rec.level === 3
        ? Math.max(0.05, 0.85 * (1 - (rec.evacPct / 100) * 0.85))
        : 0.75;
      rec.points.material.opacity = opacity;
      rec.geom.attributes.position.needsUpdate = true;
    }
  }
}
