// PopulationDots — small white dots representing residents at each population
// node. Idle: jitter at home positions. When a zone is at LEVEL 2 SET or
// LEVEL 3 GO, dots flow along the zone's evacuation route toward the largest
// shelter. The route's edgeIds is the top-frequency subset (not an ordered
// path), so we BFS over the subgraph to recover an ordered polyline.

import * as THREE from 'three';
import { bfsPolyline } from './_polyline.js';

const DOTS_PER_PERSON = 0.01;     // 100 people = 1 dot
const MIN_DOTS_PER_NODE = 2;
const MAX_DOTS_PER_NODE = 8;
const FLOW_HEIGHT = 0.04;

export class PopulationDots {
  constructor(scenario, terrain) {
    this.scenario = scenario;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'populations';
    this.dotsByZone = new Map();
    this._lastSnap = null;
    this._evacMode = false;
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
      const phases = [];
      for (const p of pops) {
        const n = this.scenario.nodes[p.nodeId];
        const cnt = Math.min(MAX_DOTS_PER_NODE,
          Math.max(MIN_DOTS_PER_NODE, Math.round(p.count * DOTS_PER_PERSON)));
        for (let i = 0; i < cnt; i++) {
          const jx = n.x + (Math.random() - 0.5) * 1.6;
          const jy = n.z + (Math.random() - 0.5) * 1.6;
          const v = this.terrain.gridToWorld(jx, jy, 0.025);
          positions.push(v.x, v.y, v.z);
          phases.push(Math.random());
        }
      }
      const arr = new Float32Array(positions);
      const base = arr.slice();
      const phaseArr = new Float32Array(phases);
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
      this.dotsByZone.set(zone, {
        positions: arr,
        base,
        phases: phaseArr,
        geom,
        points: pts,
        level: 1,
        evacPct: 0,
        polyline: null,
        flowOffset: 0
      });
    }
  }

  setEvacMode(active) {
    this._evacMode = active;
    for (const rec of this.dotsByZone.values()) {
      rec.points.material.size = active ? 0.032 : 0.022;
      rec.points.material.needsUpdate = true;
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
      if (z.level >= 2 && z.route?.edgeIds?.length && z.route.destinations?.length) {
        rec.polyline = this._buildPolyline(z);
      } else {
        rec.polyline = null;
      }
    }
  }

  _buildPolyline(zone) {
    const populations = this.scenario.populations.filter(p => p.zone === zone.name);
    if (!populations.length) return null;
    populations.sort((a, b) => b.count - a.count);
    const startNode = populations[0].nodeId;

    const topDestName = zone.route.destinations[0]?.name;
    const dest = this.scenario.shelters.find(s => s.name === topDestName);
    if (!dest) return null;

    return bfsPolyline(
      zone.route.edgeIds,
      startNode,
      dest.nodeId,
      this.scenario.edges,
      this.scenario.nodes,
      (gx, gz, h) => this.terrain.gridToWorld(gx, gz, h),
      FLOW_HEIGHT,
      3
    );
  }

  _samplePolyline(poly, t) {
    const segs = poly.length - 1;
    const u = ((t % 1) + 1) % 1;
    const sf = u * segs;
    const i = Math.floor(sf);
    const f = sf - i;
    const a = poly[i];
    const b = poly[Math.min(i + 1, poly.length - 1)];
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      z: a.z + (b.z - a.z) * f
    };
  }

  update(dt) {
    const t = performance.now() / 1000;
    for (const rec of this.dotsByZone.values()) {
      const arr = rec.positions;
      const base = rec.base;
      const phases = rec.phases;
      const flowing = !!rec.polyline && rec.level >= 2;

      if (flowing) {
        // Stream rate: GO ~0.06/s (full route in ~17s), SET ~0.025/s.
        // Evacuate mode boosts rate to emphasise urgency.
        const boost = this._evacMode ? 1.6 : 1.0;
        const rate = boost * (rec.level === 3 ? 0.06 : 0.025);
        rec.flowOffset = (rec.flowOffset + rate * dt) % 1;
        const poly = rec.polyline;
        for (let i = 0, k = 0; i < arr.length; i += 3, k++) {
          const phase = (phases[k] + rec.flowOffset) % 1;
          const p = this._samplePolyline(poly, phase);
          arr[i] = p.x;
          arr[i + 1] = p.y + Math.sin(t * 4 + k) * 0.003;
          arr[i + 2] = p.z;
        }
        // Once a fraction == evacPct of the stream has departed, dim the dots
        // riding past that point on the rear of the route (they represent
        // residents already at shelters).
        const evacFrac = Math.min(0.85, (rec.evacPct || 0) / 100);
        rec.points.material.opacity = Math.max(0.2, 0.85 - evacFrac * 0.55);
      } else {
        // Idle: subtle breathing jitter at home positions.
        for (let i = 0; i < arr.length; i += 3) {
          const j = (Math.sin(t * 1.6 + i * 0.1) * 0.5 + 0.5) * 0.005;
          arr[i] = base[i];
          arr[i + 1] = base[i + 1] + j;
          arr[i + 2] = base[i + 2];
        }
        rec.points.material.opacity = 0.75;
      }
      rec.geom.attributes.position.needsUpdate = true;
    }
  }
}
