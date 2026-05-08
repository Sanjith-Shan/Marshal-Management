// RoadRenderer — turns the scenario's edge list into a single InstancedMesh
// of small box "tiles" that follow the terrain. Highways get thicker, brighter
// segments. Blocked edges turn red with a pulsing X marker. Picking is done
// against an invisible LineSegments helper for fast per-edge raycasting.

import * as THREE from 'three';

const ROAD_LIFT = 0.018;          // push above terrain to avoid z-fighting

export class RoadRenderer {
  constructor(scenario, terrain) {
    this.scenario = scenario;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'roads';

    this._buildLines();
    this._buildPickProxy();
  }

  _buildLines() {
    const positions = [];
    const colors = [];
    const widths = [];
    const baseColor = new THREE.Color(0xa8c0d8);
    const hwyColor = new THREE.Color(0xcfe6ff);
    const trunkColor = new THREE.Color(0xb4d4ee);
    const arterialColor = new THREE.Color(0x90b0c8);

    this._edgeMeta = new Map();      // edgeId -> { startIndex, count, hwy }

    let writeIdx = 0;
    for (const e of this.scenario.edges) {
      const A = this.scenario.nodes[e.u];
      const B = this.scenario.nodes[e.v];
      const pA = this.terrain.gridToWorld(A.x, A.z, ROAD_LIFT);
      const pB = this.terrain.gridToWorld(B.x, B.z, ROAD_LIFT);

      // Subdivide so the line follows terrain
      const STEPS = 6;
      const segStart = writeIdx;
      let prev = pA;
      for (let s = 1; s <= STEPS; s++) {
        const t = s / STEPS;
        const gx = A.x + (B.x - A.x) * t;
        const gy = A.z + (B.z - A.z) * t;
        const cur = this.terrain.gridToWorld(gx, gy, ROAD_LIFT);
        positions.push(prev.x, prev.y, prev.z, cur.x, cur.y, cur.z);
        let col;
        if (e.hwy === 'motorway') col = hwyColor;
        else if (e.hwy === 'trunk') col = trunkColor;
        else if (e.hwy === 'primary') col = arterialColor;
        else col = baseColor;
        colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
        widths.push(e.lanes * 0.6);
        writeIdx += 2;
        prev = cur;
      }
      this._edgeMeta.set(e.id, { startVertex: segStart, count: writeIdx - segStart, edge: e });
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    });
    this.lines = new THREE.LineSegments(geom, this.material);
    this.lines.renderOrder = 4;
    this.group.add(this.lines);

    // Highway emphasis: a thicker tube-style overlay using TubeGeometry per highway segment
    const hwyGroup = new THREE.Group();
    for (const eid of this.scenario.highways) {
      const e = this.scenario.edges.find(x => x.id === eid);
      if (!e) continue;
      const A = this.scenario.nodes[e.u];
      const B = this.scenario.nodes[e.v];
      const points = [];
      const STEPS = 6;
      for (let s = 0; s <= STEPS; s++) {
        const t = s / STEPS;
        const gx = A.x + (B.x - A.x) * t;
        const gy = A.z + (B.z - A.z) * t;
        points.push(this.terrain.gridToWorld(gx, gy, ROAD_LIFT + 0.004));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const tubeGeom = new THREE.TubeGeometry(curve, 8, 0.012, 6, false);
      const tubeMat = new THREE.MeshBasicMaterial({
        color: 0xe8f4ff,
        transparent: true,
        opacity: 0.55,
        depthWrite: false
      });
      const tube = new THREE.Mesh(tubeGeom, tubeMat);
      tube.userData.edgeId = eid;
      hwyGroup.add(tube);
    }
    this.hwyGroup = hwyGroup;
    this.group.add(hwyGroup);

    // Per-edge color override storage
    this._origColors = new Float32Array(geom.attributes.color.array);
  }

  _buildPickProxy() {
    // Invisible thicker mesh per edge for raycaster picking.
    this._pickGroup = new THREE.Group();
    this._pickGroup.visible = true;     // raycaster ignores material visibility but we want children intersectable
    for (const e of this.scenario.edges) {
      const A = this.scenario.nodes[e.u];
      const B = this.scenario.nodes[e.v];
      const pA = this.terrain.gridToWorld(A.x, A.z, ROAD_LIFT + 0.01);
      const pB = this.terrain.gridToWorld(B.x, B.z, ROAD_LIFT + 0.01);
      const mid = pA.clone().add(pB).multiplyScalar(0.5);
      const len = pA.distanceTo(pB);
      if (len < 0.002) continue;
      const geom = new THREE.BoxGeometry(0.06, 0.04, len);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff00ff,
        transparent: true,
        opacity: 0.001,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(mid);
      mesh.lookAt(pB);
      mesh.userData.edgeId = e.id;
      this._pickGroup.add(mesh);
    }
    this.group.add(this._pickGroup);
  }

  setRoutePrimary(edgeIds) {
    // Visually mark: turn primary route segments brighter green.
    const colors = this.lines.geometry.attributes.color;
    const arr = colors.array;
    arr.set(this._origColors);
    const set = new Set(edgeIds);
    for (const [eid, meta] of this._edgeMeta) {
      if (!set.has(eid)) continue;
      for (let v = meta.startVertex; v < meta.startVertex + meta.count; v++) {
        arr[v * 3 + 0] = 0.36;
        arr[v * 3 + 1] = 0.93;
        arr[v * 3 + 2] = 0.55;
      }
    }
    colors.needsUpdate = true;
  }

  applyEdgeUpdate(u) {
    const meta = this._edgeMeta.get(u.id);
    if (!meta) return;
    const colors = this.lines.geometry.attributes.color;
    const arr = colors.array;
    let r = 0.65, g = 0.75, b = 0.85;
    if (u.blocked) { r = 1.0; g = 0.25; b = 0.25; }
    else if (u.contra) { r = 0.45; g = 0.85; b = 1.0; }
    else {
      const ic = meta.startVertex * 3;
      r = this._origColors[ic + 0];
      g = this._origColors[ic + 1];
      b = this._origColors[ic + 2];
    }
    for (let v = meta.startVertex; v < meta.startVertex + meta.count; v++) {
      arr[v * 3 + 0] = r;
      arr[v * 3 + 1] = g;
      arr[v * 3 + 2] = b;
    }
    colors.needsUpdate = true;
  }

  pickEdge(camera, ndcX, ndcY) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: ndcX, y: ndcY }, camera);
    const hits = ray.intersectObjects(this._pickGroup.children, false);
    if (!hits.length) return null;
    return hits[0].object.userData.edgeId ?? null;
  }
}
