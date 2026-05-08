// ZoneRenderer — draws semi-transparent colored polygons over each populated
// area, color-coded by Ready/Set/Go level. The polygon is the convex hull of
// the zone's population nodes, slightly offset above the terrain.

import * as THREE from 'three';

const LEVEL_COLOR = {
  1: 0x4a90e2,
  2: 0xf5d76e,
  3: 0xff5f5f,
};

export class ZoneRenderer {
  constructor(scenario, terrain) {
    this.scenario = scenario;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'zones';
    this.byZone = new Map();
    this._build();
  }

  _build() {
    // Group population nodes by zone
    const byZone = new Map();
    for (const p of this.scenario.populations) {
      if (!byZone.has(p.zone)) byZone.set(p.zone, []);
      byZone.get(p.zone).push(this.scenario.nodes[p.nodeId]);
    }
    for (const [zone, nodes] of byZone) {
      const pts = nodes.map(n => [n.x, n.z]);
      const hull = convexHull(pts);
      // Inflate hull slightly
      const center = centroid(hull);
      const inflated = hull.map(([x, y]) => {
        const dx = x - center[0], dy = y - center[1];
        const d = Math.hypot(dx, dy) || 1;
        const k = 1 + (3.0 / d);
        return [center[0] + dx * k, center[1] + dy * k];
      });
      // Build geometry as a fan triangulation
      const positions = [];
      for (let i = 1; i < inflated.length - 1; i++) {
        const a = this.terrain.gridToWorld(inflated[0][0], inflated[0][1], 0.024);
        const b = this.terrain.gridToWorld(inflated[i][0], inflated[i][1], 0.024);
        const c = this.terrain.gridToWorld(inflated[i + 1][0], inflated[i + 1][1], 0.024);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geom.computeVertexNormals();
      const mat = new THREE.MeshBasicMaterial({
        color: LEVEL_COLOR[1],
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.renderOrder = 3;
      this.group.add(mesh);

      // Outline
      const outlinePts = inflated.map(([x, y]) => this.terrain.gridToWorld(x, y, 0.027));
      outlinePts.push(outlinePts[0]);
      const outlineGeom = new THREE.BufferGeometry().setFromPoints(outlinePts);
      const outlineMat = new THREE.LineBasicMaterial({
        color: LEVEL_COLOR[1], transparent: true, opacity: 0.8, depthWrite: false
      });
      const outline = new THREE.Line(outlineGeom, outlineMat);
      this.group.add(outline);

      this.byZone.set(zone, { mesh, outline, level: 1 });
    }
  }

  applySnapshot(snap) {
    if (!snap?.evacuation?.zones) return;
    for (const z of snap.evacuation.zones) {
      const rec = this.byZone.get(z.name);
      if (!rec) continue;
      const c = LEVEL_COLOR[z.level] ?? LEVEL_COLOR[1];
      rec.mesh.material.color.setHex(c);
      rec.outline.material.color.setHex(c);
      rec.mesh.material.opacity = z.level === 3 ? 0.34 : z.level === 2 ? 0.22 : 0.16;
      rec.level = z.level;
    }
  }

  update(dt) {
    // Pulse outline of GO zones
    const t = performance.now() / 600;
    for (const rec of this.byZone.values()) {
      if (rec.level === 3) {
        rec.outline.material.opacity = 0.6 + 0.35 * Math.sin(t);
      } else {
        rec.outline.material.opacity = 0.7;
      }
    }
  }
}

// ---------- convex hull (monotone chain) ----------

function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}
