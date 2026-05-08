// RouteAnimator — for each zone with an active evacuation route, animates
// glowing arrow particles flowing from population nodes toward the shelter.
// Implemented as a Points cloud whose positions advance along the route's
// edge polyline each frame.

import * as THREE from 'three';

const PARTICLES_PER_ROUTE = 90;
const SPEED = 0.6;                // world units per second along path

export class RouteAnimator {
  constructor(scenario, terrain) {
    this.scenario = scenario;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'routes';
    this.routes = new Map();      // zoneName -> { path, particles, geometry, material }
    this._lastSnap = null;
  }

  applySnapshot(snap) {
    this._lastSnap = snap;
    if (!snap?.evacuation?.zones) return;
    // Tear down old
    for (const r of this.routes.values()) this.group.remove(r.points);
    this.routes.clear();

    for (const z of snap.evacuation.zones) {
      if (!z.route || !z.route.edgeIds) continue;
      const path = this._edgesToPolyline(z.route.edgeIds);
      if (path.length < 2) continue;
      const cumLen = [0];
      let total = 0;
      for (let i = 1; i < path.length; i++) {
        total += path[i].distanceTo(path[i - 1]);
        cumLen.push(total);
      }
      // Particle count + intensity scales with zone level
      const partCount = z.level === 3 ? PARTICLES_PER_ROUTE
                       : z.level === 2 ? Math.round(PARTICLES_PER_ROUTE * 0.6)
                       : Math.round(PARTICLES_PER_ROUTE * 0.25);
      const positions = new Float32Array(partCount * 3);
      const phases = new Float32Array(partCount);
      for (let i = 0; i < partCount; i++) phases[i] = Math.random();
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const color = z.level === 3 ? 0x66ff99
                   : z.level === 2 ? 0xfff088
                   : 0x88ccdd;
      const mat = new THREE.PointsMaterial({
        color,
        size: z.level === 3 ? 0.05 : z.level === 2 ? 0.04 : 0.028,
        transparent: true,
        opacity: z.level >= 2 ? 0.95 : 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const pts = new THREE.Points(geom, mat);
      pts.renderOrder = 6;
      this.group.add(pts);
      this.routes.set(z.name, { path, cumLen, total, phases, positions, count: partCount, geometry: geom, points: pts, level: z.level });
    }
  }

  _edgesToPolyline(edgeIds) {
    // Build a polyline by walking edges in order. Endpoints may not align;
    // we order by joining each edge to whichever endpoint of the prior edge
    // matches.
    const edges = edgeIds.map(id => this.scenario.edges.find(e => e.id === id)).filter(Boolean);
    if (edges.length === 0) return [];
    // BFS from any edge to build connected segments — simpler: join edges
    // greedily by shared endpoints.
    const used = new Array(edges.length).fill(false);
    const ordered = [edges[0]];
    used[0] = true;
    let head = edges[0].u, tail = edges[0].v;
    let progress = true;
    while (progress) {
      progress = false;
      for (let i = 0; i < edges.length; i++) {
        if (used[i]) continue;
        const e = edges[i];
        if (e.u === tail) { ordered.push(e); used[i] = true; tail = e.v; progress = true; }
        else if (e.v === tail) { ordered.push({ ...e, u: e.v, v: e.u }); used[i] = true; tail = e.u; progress = true; }
        else if (e.u === head) { ordered.unshift({ ...e, u: e.v, v: e.u }); used[i] = true; head = e.v; progress = true; }
        else if (e.v === head) { ordered.unshift(e); used[i] = true; head = e.u; progress = true; }
        if (progress) break;
      }
    }
    const pts = [];
    for (let i = 0; i < ordered.length; i++) {
      const e = ordered[i];
      const A = this.scenario.nodes[e.u];
      const B = this.scenario.nodes[e.v];
      if (i === 0) pts.push(this.terrain.gridToWorld(A.x, A.z, 0.04));
      // subdivide
      const STEPS = 4;
      for (let s = 1; s <= STEPS; s++) {
        const t = s / STEPS;
        const gx = A.x + (B.x - A.x) * t;
        const gy = A.z + (B.z - A.z) * t;
        pts.push(this.terrain.gridToWorld(gx, gy, 0.04));
      }
    }
    return pts;
  }

  update(dt) {
    const t = performance.now() / 1000;
    for (const route of this.routes.values()) {
      const { path, cumLen, total, phases, positions, geometry, count, level } = route;
      const speed = level === 3 ? SPEED * 1.4 : level === 2 ? SPEED : SPEED * 0.6;
      for (let i = 0; i < count; i++) {
        let p = (phases[i] + t * speed / total) % 1;
        const targetLen = p * total;
        let lo = 0, hi = cumLen.length - 1;
        while (lo + 1 < hi) {
          const mid = (lo + hi) >> 1;
          if (cumLen[mid] < targetLen) lo = mid;
          else hi = mid;
        }
        const segLen = cumLen[hi] - cumLen[lo];
        const f = segLen > 0 ? (targetLen - cumLen[lo]) / segLen : 0;
        const A = path[lo], B = path[hi];
        positions[i * 3 + 0] = A.x + (B.x - A.x) * f;
        positions[i * 3 + 1] = A.y + (B.y - A.y) * f + 0.005 * Math.sin(t * 4 + i);
        positions[i * 3 + 2] = A.z + (B.z - A.z) * f;
      }
      geometry.attributes.position.needsUpdate = true;
    }
  }
}
