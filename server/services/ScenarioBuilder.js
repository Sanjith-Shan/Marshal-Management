// ScenarioBuilder — generates a self-consistent demo world: terrain heightmap,
// fuel grid, road network (highways + arterials + residential grid), population
// clusters, shelters, and an initial fire ignition point.
//
// Inspired by the 2003 Cedar Fire corridor: Scripps Ranch / Poway / Ramona.
// All generation is deterministic on a seed so the demo is reproducible.

import { mulberry32 } from './rng.js';

const GRID = 128;          // CA grid resolution
const WORLD_M = 24_000;    // 24 km world span
const M_PER_CELL = WORLD_M / GRID;

// Fuel classes match the Rothermel-lite model used client-side.
const FUEL = {
  ROCK: 0,
  GRASS: 1,
  CHAPARRAL: 2,
  TIMBER: 3,
  URBAN: 4,
};

export const ScenarioBuilder = {
  build({ seed = 42 } = {}) {
    const rng = mulberry32(seed);

    const heightmap = generateHeightmap(rng);
    const fuelGrid = generateFuelGrid(heightmap, rng);
    const { nodes, edges, highways } = generateRoadNetwork(rng);
    const populations = generatePopulations(nodes, rng);
    const shelters = pickShelters(nodes, populations);
    const zones = defineZones(populations);
    const ignition = pickIgnition(heightmap, fuelGrid, rng);

    // Sanity: every population node must reach at least one shelter via the
    // road graph. This is a hidden check that runs at scenario build time.
    const reach = reachabilityCheck(nodes, edges, populations, shelters);
    if (!reach.ok) {
      console.warn(`[scenario] reachability gap: ${reach.unreachable} pop-nodes cannot reach a shelter`);
    }

    return {
      seed,
      name: 'Cedar Corridor — San Diego County',
      gridSize: GRID,
      worldMeters: WORLD_M,
      mPerCell: M_PER_CELL,
      heightmap,                 // Float32Array length GRID*GRID, 0..1
      fuelGrid,                  // Uint8Array length GRID*GRID, 0..4
      nodes,                     // [{id, x, z, h}]      x/z in cell coords
      edges,                     // [{id, u, v, lanes, capacity, speed, hwy, blocked, contra}]
      highways,                  // [edgeId,...] subset for visual emphasis
      populations,               // [{nodeId, count}]
      shelters,                  // [{nodeId, name, capacity, used}]
      zones,                     // [{id, name, populationIds, level, etaMin, evacMin, marginMin, evacuatedPct, route, bottleneck}]
      ignition,                  // {gx, gy} cell coords
      meta: { generatedAt: Date.now(), reach }
    };
  }
};

// ---------- terrain ----------

function generateHeightmap(rng) {
  // Multi-octave value noise. Adds a SE-NW ridge and a basin to mimic the
  // Cedar Fire corridor's general topography.
  const arr = new Float32Array(GRID * GRID);
  const octaves = [
    { freq: 1.6, amp: 0.55 },
    { freq: 3.4, amp: 0.30 },
    { freq: 7.0, amp: 0.18 },
    { freq: 14.0, amp: 0.08 }
  ];
  // Build a base noise per octave with random gradients
  const grids = octaves.map(({ freq }) => {
    const n = Math.max(2, Math.ceil(freq) + 1);
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rng() * 2 - 1;
    return { n, g };
  });

  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      let h = 0;
      const nx = x / GRID;
      const ny = y / GRID;
      for (let oi = 0; oi < octaves.length; oi++) {
        const { freq, amp } = octaves[oi];
        const { n, g } = grids[oi];
        const fx = nx * (n - 1);
        const fy = ny * (n - 1);
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1);
        const tx = smooth(fx - x0), ty = smooth(fy - y0);
        const a = g[y0 * n + x0], b = g[y0 * n + x1];
        const c = g[y1 * n + x0], d = g[y1 * n + x1];
        h += amp * lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
      }
      // Bias: SE-NW ridge
      const ridge = Math.exp(-Math.pow((x - y * 0.6 - 30) / 40, 2)) * 0.35;
      // Western basin (low coastal area)
      const basin = Math.exp(-Math.pow((x - 18) / 22, 2)) * -0.18;
      h = h * 0.5 + 0.5 + ridge + basin;
      arr[y * GRID + x] = clamp01(h);
    }
  }
  return arr;
}

function generateFuelGrid(heightmap, rng) {
  const arr = new Uint8Array(GRID * GRID);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const h = heightmap[y * GRID + x];
      const r = rng();
      let fuel;
      if (h < 0.18) fuel = FUEL.ROCK;          // dry creek beds / rock
      else if (h < 0.32) {
        fuel = r < 0.7 ? FUEL.GRASS : FUEL.CHAPARRAL;
      } else if (h < 0.55) {
        fuel = r < 0.55 ? FUEL.CHAPARRAL : (r < 0.85 ? FUEL.GRASS : FUEL.TIMBER);
      } else if (h < 0.75) {
        fuel = r < 0.7 ? FUEL.TIMBER : FUEL.CHAPARRAL;
      } else {
        fuel = r < 0.6 ? FUEL.TIMBER : FUEL.ROCK;
      }
      arr[y * GRID + x] = fuel;
    }
  }
  // Carve an "urban" cluster around the southwestern flat (Scripps Ranch-ish)
  carveUrban(arr, heightmap, 28, 38, 11);
  carveUrban(arr, heightmap, 64, 50, 9);   // Poway-ish
  carveUrban(arr, heightmap, 96, 78, 8);   // Ramona-ish
  return arr;
}

function carveUrban(fuel, height, cx, cy, r) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= GRID || y >= GRID) continue;
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= r && height[y * GRID + x] < 0.6) fuel[y * GRID + x] = FUEL.URBAN;
    }
  }
}

// ---------- road network ----------
//
// We synthesize three layers:
//   1. Two highways (motorway-class) crossing the world: I-15 N–S, SR-67 NE–SW
//   2. Several arterials connecting urban clusters
//   3. A residential grid inside each urban cluster
// Resulting network is connected and looks plausibly like SD county roads.

function generateRoadNetwork(rng) {
  const nodes = [];
  const edges = [];
  const nodeKey = new Map();          // "gx,gy" -> nodeId

  const addNode = (gx, gy) => {
    const key = `${gx},${gy}`;
    if (nodeKey.has(key)) return nodeKey.get(key);
    const id = nodes.length;
    nodes.push({ id, x: gx, z: gy });
    nodeKey.set(key, id);
    return id;
  };

  let edgeId = 0;
  const addEdge = (u, v, attrs) => {
    if (u === v) return null;
    const e = { id: edgeId++, u, v, blocked: false, contra: false, ...attrs };
    edges.push(e);
    return e;
  };

  // ----- Highway 1 (I-15 analogue): north–south, slightly curved -----
  const hwy1Nodes = [];
  for (let gy = 0; gy < GRID; gy += 4) {
    const gx = Math.round(28 + Math.sin(gy / 22) * 4);
    hwy1Nodes.push(addNode(gx, gy));
  }
  const hwy1Edges = [];
  for (let i = 0; i < hwy1Nodes.length - 1; i++) {
    hwy1Edges.push(addEdge(hwy1Nodes[i], hwy1Nodes[i + 1], {
      lanes: 4, capacity: 8000, speed: 80, hwy: 'motorway'
    }));
  }

  // ----- Highway 2 (SR-67 analogue): NE -> SW -----
  const hwy2Nodes = [];
  for (let t = 0; t <= 32; t++) {
    const gx = Math.round(20 + t * 3.0);
    const gy = Math.round(110 - t * 3.0);
    if (gx >= 0 && gx < GRID && gy >= 0 && gy < GRID) hwy2Nodes.push(addNode(gx, gy));
  }
  const hwy2Edges = [];
  for (let i = 0; i < hwy2Nodes.length - 1; i++) {
    hwy2Edges.push(addEdge(hwy2Nodes[i], hwy2Nodes[i + 1], {
      lanes: 2, capacity: 3600, speed: 65, hwy: 'trunk'
    }));
  }

  // ----- Urban cluster grids -----
  const clusters = [
    { name: 'Scripps Ranch', cx: 28, cy: 38, w: 14, h: 10 },
    { name: 'Poway',         cx: 64, cy: 50, w: 12, h: 10 },
    { name: 'Ramona',        cx: 96, cy: 78, w: 10, h: 8 },
  ];
  const clusterCenters = [];
  for (const c of clusters) {
    const gridStep = 2;
    const xs = [];
    const ys = [];
    for (let gx = c.cx - c.w; gx <= c.cx + c.w; gx += gridStep) xs.push(gx);
    for (let gy = c.cy - c.h; gy <= c.cy + c.h; gy += gridStep) ys.push(gy);
    // Add nodes
    for (const gy of ys) {
      for (const gx of xs) {
        addNode(gx, gy);
      }
    }
    // Add edges (rectangular streets)
    for (const gy of ys) {
      for (let i = 0; i < xs.length - 1; i++) {
        const u = nodeKey.get(`${xs[i]},${gy}`);
        const v = nodeKey.get(`${xs[i + 1]},${gy}`);
        addEdge(u, v, { lanes: 1, capacity: 800, speed: 25, hwy: 'residential' });
      }
    }
    for (const gx of xs) {
      for (let j = 0; j < ys.length - 1; j++) {
        const u = nodeKey.get(`${gx},${ys[j]}`);
        const v = nodeKey.get(`${gx},${ys[j + 1]}`);
        addEdge(u, v, { lanes: 1, capacity: 800, speed: 25, hwy: 'residential' });
      }
    }
    clusterCenters.push({ ...c, centerNode: addNode(c.cx, c.cy) });
  }

  // ----- Connect clusters to highways with arterials -----
  const arterialPairs = [
    [clusterCenters[0].centerNode, nearestNodeOnPath(nodes, hwy1Nodes, 28, 38)],
    [clusterCenters[1].centerNode, nearestNodeOnPath(nodes, hwy1Nodes, 64, 50)],
    [clusterCenters[1].centerNode, nearestNodeOnPath(nodes, hwy2Nodes, 64, 50)],
    [clusterCenters[2].centerNode, nearestNodeOnPath(nodes, hwy2Nodes, 96, 78)],
    [clusterCenters[0].centerNode, clusterCenters[1].centerNode],
    [clusterCenters[1].centerNode, clusterCenters[2].centerNode],
  ];
  for (const [a, b] of arterialPairs) {
    if (a === null || b === null) continue;
    layArterial(nodes, edges, addNode, addEdge, a, b);
  }

  const highways = hwy1Edges.concat(hwy2Edges).filter(Boolean).map(e => e.id);
  return { nodes, edges, highways };
}

function nearestNodeOnPath(nodes, pathNodeIds, gx, gy) {
  let best = null, bestD = Infinity;
  for (const id of pathNodeIds) {
    const n = nodes[id];
    const d = Math.hypot(n.x - gx, n.z - gy);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

function layArterial(nodes, edges, addNode, addEdge, a, b) {
  // Rasterize a straight line between a and b, dropping nodes every ~3 cells.
  const A = nodes[a], B = nodes[b];
  if (!A || !B) return;
  const dx = B.x - A.x, dy = B.z - A.z;
  const dist = Math.hypot(dx, dy);
  const step = 3;
  const steps = Math.max(1, Math.round(dist / step));
  let prev = a;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const gx = Math.round(A.x + dx * t);
    const gy = Math.round(A.z + dy * t);
    if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) continue;
    const cur = addNode(gx, gy);
    if (cur !== prev) {
      addEdge(prev, cur, { lanes: 2, capacity: 2400, speed: 45, hwy: 'primary' });
      prev = cur;
    }
  }
}

// ---------- populations ----------

function generatePopulations(nodes, rng) {
  // For each cluster centroid, distribute population across ~30 nearest nodes.
  const targets = [
    { cx: 28, cy: 38, total: 3200, name: 'Scripps Ranch' },
    { cx: 64, cy: 50, total: 2100, name: 'Poway' },
    { cx: 96, cy: 78, total: 4800, name: 'Ramona' },
  ];
  const populations = [];
  const used = new Set();
  for (const t of targets) {
    const ranked = nodes
      .map(n => ({ n, d: Math.hypot(n.x - t.cx, n.z - t.cy) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 40);
    let remaining = t.total;
    for (let i = 0; i < ranked.length; i++) {
      const k = ranked[i].n.id;
      if (used.has(k)) continue;
      const p = i === ranked.length - 1
        ? remaining
        : Math.round(remaining * (0.05 + rng() * 0.06));
      const c = Math.max(0, Math.min(remaining, p));
      if (c > 0) {
        populations.push({ nodeId: k, count: c, zone: t.name });
        remaining -= c;
        used.add(k);
      }
      if (remaining <= 0) break;
    }
    if (remaining > 0 && ranked.length) populations.push({
      nodeId: ranked[0].n.id, count: remaining, zone: t.name
    });
  }
  return populations;
}

function pickShelters(nodes, populations) {
  // 3 shelters, on the road network but outside the urban centers.
  const candidates = [
    { gx: 12, gy: 30, name: 'Alliant Univ.', capacity: 800 },
    { gx: 50, gy: 100, name: 'Poway HS', capacity: 600 },
    { gx: 18, gy: 90, name: 'Qualcomm Stadium', capacity: 8000 },
  ];
  const populationNodeIds = new Set(populations.map(p => p.nodeId));
  return candidates.map(c => {
    let best = null, bestD = Infinity;
    for (const n of nodes) {
      if (populationNodeIds.has(n.id)) continue;
      const d = Math.hypot(n.x - c.gx, n.z - c.gy);
      if (d < bestD) { bestD = d; best = n; }
    }
    return { nodeId: best.id, name: c.name, capacity: c.capacity, used: 0 };
  });
}

function defineZones(populations) {
  const grouped = new Map();
  for (const p of populations) {
    if (!grouped.has(p.zone)) grouped.set(p.zone, []);
    grouped.get(p.zone).push(p.nodeId);
  }
  const zones = [];
  let zid = 0;
  for (const [name, ids] of grouped) {
    zones.push({
      id: `Z${zid++}`,
      name,
      populationNodeIds: ids,
      level: 1,                  // 1 = Ready, 2 = Set, 3 = Go
      etaMin: 999,               // fire arrival
      evacMin: 0,                // time to fully evacuate
      marginMin: 999,
      evacuatedPct: 0,
      route: null,
      bottleneck: null,
      override: null
    });
  }
  return zones;
}

function pickIgnition(heightmap, fuelGrid, rng) {
  // Pick a high-fuel cell upwind of the Ramona urban centroid (96, 78). The
  // wind blows ~SW (220° = from SW = blows toward NE — wait, "from SW" means
  // wind moves NE, away from urban areas). For dramatic demo we want fire
  // to threaten urban areas, so we ignite NE of the Ramona cluster and rely
  // on the wind blowing it toward urban areas. With wind FROM 220° (SW)
  // wind moves toward NE, so we should ignite SW of urban cluster instead.
  // Place ignition just NE of the inland urban centroid (Ramona at 96,78)
  // so southwesterly winds push fire away — but our procedural wind shifts.
  // Simplest demo: ignite between Ramona and Poway, in chaparral, ~10 cells
  // upwind of urban so the user sees fire approach within ~60 sim minutes.
  const targets = [
    { gx: 82, gy: 65 }, { gx: 78, gy: 60 }, { gx: 70, gy: 55 },
    { gx: 88, gy: 70 }, { gx: 75, gy: 70 },
  ];
  for (const t of targets) {
    const f = fuelGrid[t.gy * GRID + t.gx];
    if (f === FUEL.CHAPARRAL || f === FUEL.GRASS || f === FUEL.TIMBER) {
      return t;
    }
  }
  // Fallback search
  for (let y = 55; y < 80; y++) {
    for (let x = 55; x < 100; x++) {
      const f = fuelGrid[y * GRID + x];
      if (f === FUEL.CHAPARRAL || f === FUEL.GRASS) return { gx: x, gy: y };
    }
  }
  return { gx: 80, gy: 65 };
}

function reachabilityCheck(nodes, edges, populations, shelters) {
  const adj = new Map();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    adj.get(e.u).push(e.v);
    adj.get(e.v).push(e.u);
  }
  const shelterIds = new Set(shelters.map(s => s.nodeId));
  // BFS from any shelter; mark reachable.
  const visited = new Set();
  const q = [...shelterIds];
  for (const s of shelterIds) visited.add(s);
  while (q.length) {
    const u = q.shift();
    for (const v of (adj.get(u) || [])) {
      if (!visited.has(v)) { visited.add(v); q.push(v); }
    }
  }
  let unreachable = 0;
  for (const p of populations) if (!visited.has(p.nodeId)) unreachable++;
  return { ok: unreachable === 0, unreachable };
}

// ---------- helpers ----------

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export const FUEL_NAMES = ['Rock', 'Grass', 'Chaparral', 'Timber', 'Urban'];
export { FUEL };
