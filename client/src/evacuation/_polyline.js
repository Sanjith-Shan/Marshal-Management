// Shared polyline utilities for evacuation renderers.
// route.edgeIds is a frequency-ranked subset of route edges, NOT an ordered
// path. Two reconstruction strategies are provided:
//   bfsPolyline  — BFS from a known start node through the subgraph to a
//                  known end node. Reliable when start/end are known.
//   chainPolyline — greedy chain-walk from edge[0] outward. Faster but
//                   silently drops disconnected components.

/**
 * BFS through the subgraph defined by edgeIds, from startNodeId to endNodeId.
 * Returns an ordered array of THREE.Vector3 world-space points, or null if
 * the path cannot be connected.
 *
 * @param {number[]} edgeIds
 * @param {number} startNodeId
 * @param {number} endNodeId
 * @param {object[]} allEdges    — scenario.edges
 * @param {object[]} allNodes    — scenario.nodes
 * @param {function} gridToWorld — terrain.gridToWorld(gx, gz, hOffset)
 * @param {number}   hOffset     — vertical lift above terrain
 * @param {number}   subdivide   — subdivisions per edge segment
 */
export function bfsPolyline(edgeIds, startNodeId, endNodeId, allEdges, allNodes, gridToWorld, hOffset = 0.04, subdivide = 4) {
  const allowed = new Set(edgeIds);
  const adj = new Map();
  for (const e of allEdges) {
    if (!allowed.has(e.id)) continue;
    if (!adj.has(e.u)) adj.set(e.u, []);
    if (!adj.has(e.v)) adj.set(e.v, []);
    adj.get(e.u).push({ nb: e.v, edgeId: e.id });
    adj.get(e.v).push({ nb: e.u, edgeId: e.id });
  }
  const came = new Map();
  came.set(startNodeId, null);
  const queue = [startNodeId];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === endNodeId) break;
    for (const { nb } of adj.get(cur) || []) {
      if (!came.has(nb)) {
        came.set(nb, cur);
        queue.push(nb);
      }
    }
  }
  if (!came.has(endNodeId)) return null;

  const nodeIds = [];
  let cur = endNodeId;
  while (cur != null) {
    nodeIds.unshift(cur);
    cur = came.get(cur);
  }
  if (nodeIds.length < 2) return null;

  return nodesToPolyline(nodeIds, allNodes, gridToWorld, hOffset, subdivide);
}

/**
 * Greedy chain-walk: starts from edge[0] and tries to connect each subsequent
 * edge by matching shared endpoints. Disconnected tails are dropped silently.
 *
 * @param {number[]} edgeIds
 * @param {object[]} allEdges
 * @param {object[]} allNodes
 * @param {function} gridToWorld
 * @param {number}   hOffset
 * @param {number}   subdivide
 */
export function chainPolyline(edgeIds, allEdges, allNodes, gridToWorld, hOffset = 0.04, subdivide = 4) {
  const edges = edgeIds.map(id => allEdges.find(e => e.id === id)).filter(Boolean);
  if (edges.length === 0) return [];

  const used = new Array(edges.length).fill(false);
  const ordered = [{ ...edges[0] }];
  used[0] = true;
  let head = edges[0].u, tail = edges[0].v;
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < edges.length; i++) {
      if (used[i]) continue;
      const e = edges[i];
      if (e.u === tail)      { ordered.push({ ...e });           used[i] = true; tail = e.v;  progress = true; }
      else if (e.v === tail) { ordered.push({ ...e, u: e.v, v: e.u }); used[i] = true; tail = e.u;  progress = true; }
      else if (e.u === head) { ordered.unshift({ ...e, u: e.v, v: e.u }); used[i] = true; head = e.v; progress = true; }
      else if (e.v === head) { ordered.unshift({ ...e });         used[i] = true; head = e.u; progress = true; }
      if (progress) break;
    }
  }

  const nodeIds = ordered.length > 0
    ? [ordered[0].u, ...ordered.map(e => e.v)]
    : [];
  return nodesToPolyline(nodeIds, allNodes, gridToWorld, hOffset, subdivide);
}

function nodesToPolyline(nodeIds, allNodes, gridToWorld, hOffset, subdivide) {
  const pts = [];
  for (let i = 0; i < nodeIds.length; i++) {
    const A = allNodes[nodeIds[i]];
    if (i === 0) {
      pts.push(gridToWorld(A.x, A.z, hOffset));
      continue;
    }
    const B_prev = allNodes[nodeIds[i - 1]];
    for (let s = 1; s <= subdivide; s++) {
      const t = s / subdivide;
      const gx = B_prev.x + (A.x - B_prev.x) * t;
      const gz = B_prev.z + (A.z - B_prev.z) * t;
      pts.push(gridToWorld(gx, gz, hOffset));
    }
  }
  return pts;
}
