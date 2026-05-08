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
    this._blockedXGroup = new THREE.Group();
    this._blockedXGroup.name = 'blocked-x';
    this.group.add(this._blockedXGroup);
    this._blockedXMap = new Map();   // edgeId -> THREE.Mesh (the X marker)
    this._hoverEdgeId = null;
    this._primarySet = new Set();
    this._secondarySet = new Set();
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

  setRoutePrimary(edgeIds, secondaryEdgeIds = []) {
    this._primarySet   = new Set(edgeIds);
    this._secondarySet = new Set(secondaryEdgeIds);
    const colors = this.lines.geometry.attributes.color;
    const arr = colors.array;
    arr.set(this._origColors);
    for (const [eid, meta] of this._edgeMeta) {
      let r, g, b;
      if (this._primarySet.has(eid))        { r = 0.36; g = 0.93; b = 0.55; }
      else if (this._secondarySet.has(eid)) { r = 0.22; g = 0.68; b = 0.45; }
      else continue;
      for (let v = meta.startVertex; v < meta.startVertex + meta.count; v++) {
        arr[v * 3 + 0] = r;
        arr[v * 3 + 1] = g;
        arr[v * 3 + 2] = b;
      }
    }
    colors.needsUpdate = true;
  }

  // Hover highlight in COMMAND mode. Restores the previous hovered edge to
  // whatever its logical state was (blocked, route, original).
  setHover(edgeId) {
    if (this._hoverEdgeId === edgeId) return;
    const colors = this.lines.geometry.attributes.color;
    const arr = colors.array;

    // Restore previous hovered edge
    if (this._hoverEdgeId !== null) {
      this._writeEdgeColor(arr, this._hoverEdgeId, false);
    }
    this._hoverEdgeId = edgeId;

    // Apply hover color to new edge
    if (edgeId !== null) {
      const meta = this._edgeMeta.get(edgeId);
      if (meta) {
        for (let v = meta.startVertex; v < meta.startVertex + meta.count; v++) {
          arr[v * 3 + 0] = 1.0;
          arr[v * 3 + 1] = 0.92;
          arr[v * 3 + 2] = 0.35;   // warm yellow hover
        }
      }
    }
    colors.needsUpdate = true;
  }

  _writeEdgeColor(arr, edgeId, isHover) {
    const meta = this._edgeMeta.get(edgeId);
    if (!meta) return;
    const e = this.scenario.edges.find(ed => ed.id === edgeId);
    let r, g, b;
    if (e?.blocked)                         { r = 1.0;  g = 0.25; b = 0.25; }
    else if (e?.contra)                     { r = 0.45; g = 0.85; b = 1.0;  }
    else if (this._primarySet.has(edgeId))  { r = 0.36; g = 0.93; b = 0.55; }
    else if (this._secondarySet.has(edgeId)){ r = 0.22; g = 0.68; b = 0.45; }
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

    // Blocked X marker: add on block, remove on unblock.
    if (u.blocked && !this._blockedXMap.has(u.id)) {
      const e = this.scenario.edges.find(ed => ed.id === u.id);
      if (e) {
        const A = this.scenario.nodes[e.u];
        const B = this.scenario.nodes[e.v];
        const mid = this.terrain.gridToWorld((A.x + B.x) / 2, (A.z + B.z) / 2, ROAD_LIFT + 0.02);
        const xMesh = this._makeXMarker(mid);
        this._blockedXGroup.add(xMesh);
        this._blockedXMap.set(u.id, xMesh);
      }
    } else if (!u.blocked && this._blockedXMap.has(u.id)) {
      this._blockedXGroup.remove(this._blockedXMap.get(u.id));
      this._blockedXMap.delete(u.id);
    }
  }

  _makeXMarker(pos) {
    // Two thin boxes crossed at 45°
    const mat = new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.9, depthWrite: false });
    const barGeom = new THREE.BoxGeometry(0.18, 0.01, 0.025);
    const group = new THREE.Group();
    const bar1 = new THREE.Mesh(barGeom, mat);
    bar1.rotation.y = Math.PI / 4;
    const bar2 = new THREE.Mesh(barGeom, mat);
    bar2.rotation.y = -Math.PI / 4;
    group.add(bar1, bar2);
    group.position.copy(pos);
    group.renderOrder = 8;
    return group;
  }

  update(dt) {
    // Pulse the X markers
    const t = performance.now() / 500;
    for (const xGroup of this._blockedXMap.values()) {
      const s = 1 + 0.18 * Math.sin(t);
      xGroup.scale.setScalar(s);
    }
  }

  pickEdge(camera, ndcX, ndcY) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: ndcX, y: ndcY }, camera);
    const hits = ray.intersectObjects(this._pickGroup.children, false);
    if (!hits.length) return null;
    return hits[0].object.userData.edgeId ?? null;
  }
}
