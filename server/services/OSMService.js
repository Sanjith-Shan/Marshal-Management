// OSMService — fetches real San Diego road network for the Cedar Corridor
// bbox via the Overpass API, projects every OSM node into our grid
// coordinate space, and converts the response into the same {nodes, edges,
// highways} shape the procedural ScenarioBuilder produces. Caches to disk
// so repeat startups are instant; falls back to procedural on any failure.
//
// Without internet access the cache file (if present from a prior run)
// still loads, so demos work offline once they've fetched once.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fetch from 'node-fetch';

import { BBOX, latLngToGrid } from './ScenarioBuilder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.resolve(__dirname, '../../data/osm-cedar.json');
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Defaults applied per OSM `highway` tag class. Values mirror the ones
// EvacuationEngine already understands. Residential + unclassified are
// excluded server-side because OSM has ~70 000 of them in San Diego County
// and the Three.js renderer + raycaster picker can't keep up with that
// edge count. The evacuation engine routes on what's here; bottleneck
// behavior is unchanged because residential streets carry tiny capacity
// anyway.
const ROAD_DEFAULTS = {
  motorway:       { lanes: 4, capacity: 8000, speed: 105 },
  motorway_link:  { lanes: 1, capacity: 1500, speed: 60 },
  trunk:          { lanes: 2, capacity: 3600, speed: 90 },
  trunk_link:     { lanes: 1, capacity: 1200, speed: 50 },
  primary:        { lanes: 2, capacity: 2400, speed: 65 },
  primary_link:   { lanes: 1, capacity: 1000, speed: 45 },
  secondary:      { lanes: 2, capacity: 1800, speed: 55 },
  secondary_link: { lanes: 1, capacity: 900,  speed: 40 },
  tertiary:       { lanes: 1, capacity: 1200, speed: 45 },
  tertiary_link:  { lanes: 1, capacity: 800,  speed: 35 },
};

// Highways list (visual emphasis): only motorway + trunk get the thick tube.
const EMPHASIS_CLASSES = new Set(['motorway', 'trunk']);

const ALLOWED_HIGHWAYS = Object.keys(ROAD_DEFAULTS).join('|');

const OVERPASS_QUERY = `
[out:json][timeout:60];
(
  way["highway"~"^(${ALLOWED_HIGHWAYS})$"]
    (${BBOX.latMin},${BBOX.lngMin},${BBOX.latMax},${BBOX.lngMax});
);
out body;
>;
out skel qt;
`.trim();

export async function loadOSMRoadNetwork({ forceRefetch = false } = {}) {
  if (process.env.MM_FORCE_MOCK === '1' || process.env.OSM_DISABLED === '1') {
    return null;
  }
  // 1. Try cached file
  if (!forceRefetch) {
    try {
      const buf = await fs.readFile(CACHE_PATH, 'utf8');
      const cached = JSON.parse(buf);
      if (cached?.nodes?.length && cached?.edges?.length) {
        console.log(`[osm] using cached road network (${cached.nodes.length} nodes, ${cached.edges.length} edges)`);
        return cached;
      }
    } catch (err) {
      // No cache yet — fall through to fetch.
    }
  }
  // 2. Fetch from Overpass
  try {
    console.log('[osm] fetching road network from Overpass…');
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(OVERPASS_QUERY),
      timeout: 90_000,
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    const data = await res.json();
    const network = parseOverpassResponse(data);
    if (!network.nodes.length) throw new Error('Overpass returned no nodes');
    // 3. Cache to disk
    await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
    await fs.writeFile(CACHE_PATH, JSON.stringify(network));
    console.log(`[osm] cached real road network: ${network.nodes.length} nodes, ${network.edges.length} edges, ${network.highways.length} highway segments`);
    return network;
  } catch (err) {
    console.warn('[osm] fetch failed, falling back to procedural:', err.message);
    return null;
  }
}

function parseOverpassResponse(data) {
  const elements = data.elements || [];
  // Index OSM nodes by id and project to grid.
  const osmNodes = new Map();
  for (const el of elements) {
    if (el.type === 'node') {
      const { gx, gy } = latLngToGrid(el.lat, el.lon);
      osmNodes.set(el.id, { lat: el.lat, lng: el.lon, gx, gy });
    }
  }

  // Filter ways to drivable highway classes we know about.
  const ways = [];
  for (const el of elements) {
    if (el.type !== 'way') continue;
    if (!el.tags?.highway || !ROAD_DEFAULTS[el.tags.highway]) continue;
    if (!Array.isArray(el.nodes) || el.nodes.length < 2) continue;
    ways.push(el);
  }

  // Topology compression: count how many ways each node belongs to. Nodes
  // referenced by 2+ ways are real intersections; nodes referenced by only
  // one way are shape-only (the road bends through them) and can be
  // collapsed. We keep way endpoints unconditionally so disconnected
  // segments stay routable.
  const refCount = new Map();
  for (const w of ways) {
    for (const nid of w.nodes) {
      refCount.set(nid, (refCount.get(nid) || 0) + 1);
    }
  }
  const isIntersection = (osmId, idx, way) =>
    refCount.get(osmId) >= 2 || idx === 0 || idx === way.nodes.length - 1;

  // Build sequential node ids only for retained intersections.
  const nodes = [];
  const osmToSeq = new Map();
  function ensureNode(osmId) {
    if (osmToSeq.has(osmId)) return osmToSeq.get(osmId);
    const p = osmNodes.get(osmId);
    if (!p) return null;
    const seqId = nodes.length;
    nodes.push({ id: seqId, x: p.gx, z: p.gy, lat: p.lat, lng: p.lng });
    osmToSeq.set(osmId, seqId);
    return seqId;
  }

  // Walk each way; emit one edge between successive intersection nodes.
  let edgeId = 0;
  const edges = [];
  const highways = [];
  for (const w of ways) {
    const cls = w.tags.highway;
    const def = ROAD_DEFAULTS[cls];
    const lanes = parseLanes(w.tags.lanes, def.lanes);
    const speed = parseSpeed(w.tags.maxspeed, def.speed);
    const capacity = lanes * (def.capacity / def.lanes);

    let lastIdx = -1;
    for (let i = 0; i < w.nodes.length; i++) {
      if (!isIntersection(w.nodes[i], i, w)) continue;
      const seqId = ensureNode(w.nodes[i]);
      if (seqId == null) { lastIdx = -1; continue; }
      if (lastIdx !== -1 && lastIdx !== seqId) {
        const e = {
          id: edgeId++,
          u: lastIdx, v: seqId,
          lanes, capacity, speed,
          hwy: cls,
          blocked: false, contra: false,
        };
        edges.push(e);
        if (EMPHASIS_CLASSES.has(cls)) highways.push(e.id);
      }
      lastIdx = seqId;
    }
  }

  return { nodes, edges, highways };
}

function parseLanes(tag, fallback) {
  const n = parseInt(tag, 10);
  return Number.isFinite(n) && n > 0 && n < 12 ? n : fallback;
}

function parseSpeed(tag, fallback) {
  if (!tag) return fallback;
  const m = String(tag).match(/(\d+)\s*(mph|kmh|kph)?/i);
  if (!m) return fallback;
  const v = parseInt(m[1], 10);
  if (!Number.isFinite(v)) return fallback;
  // Convert mph to km/h
  return /mph/i.test(m[2] || '') ? Math.round(v * 1.60934) : v;
}
