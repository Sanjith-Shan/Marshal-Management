// TerrainService — pulls real elevation data from USGS 3DEP via the
// Elevation Point Query Service (EPQS), assembles a low-res sampled grid,
// normalizes it, caches to disk, and returns a Float32Array compatible
// with the procedural heightmap ScenarioBuilder generates.
//
// Resolution trade-off: EPQS serves one point per request. We sample at
// 33×33 = 1089 points across the bbox, run them in parallel with bounded
// concurrency (~2 s end-to-end on a warm connection), then bilinear-
// resample to 128×128 at scenario build time.
//
// On any failure (offline, EPQS rate-limit, partial NaN response), we
// return null and ScenarioBuilder falls back to procedural noise.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fetch from 'node-fetch';

import { BBOX } from './ScenarioBuilder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.resolve(__dirname, '../../data/cedar-corridor-dem.json');
const SAMPLE_RES = 33;          // 33×33 = 1089 points
const TARGET_RES = 128;         // ScenarioBuilder grid size
const CONCURRENCY = 40;         // parallel EPQS requests
const MIN_VALID_FRAC = 0.7;     // ≥70% of samples must succeed

const EPQS_URL = (lat, lng) =>
  `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&units=Meters&wkid=4326`;

export async function loadTerrainHeightmap({ forceRefetch = false } = {}) {
  if (process.env.MM_FORCE_MOCK === '1' || process.env.DEM_DISABLED === '1') {
    return null;
  }

  // 1. Try cache
  if (!forceRefetch) {
    try {
      const buf = await fs.readFile(CACHE_PATH, 'utf8');
      const cached = JSON.parse(buf);
      if (cached?.heights?.length === SAMPLE_RES * SAMPLE_RES) {
        console.log(`[dem] using cached USGS heightmap (${cached.minM.toFixed(0)}m – ${cached.maxM.toFixed(0)}m)`);
        return resampleAndNormalize(cached.heights, cached.minM, cached.maxM);
      }
    } catch {
      // fall through to fetch
    }
  }

  // 2. Sample USGS EPQS in parallel
  console.log(`[dem] fetching ${SAMPLE_RES}×${SAMPLE_RES} elevation samples from USGS EPQS…`);
  const t0 = Date.now();
  const tasks = [];
  for (let y = 0; y < SAMPLE_RES; y++) {
    for (let x = 0; x < SAMPLE_RES; x++) {
      const lng = BBOX.lngMin + (x / (SAMPLE_RES - 1)) * (BBOX.lngMax - BBOX.lngMin);
      const lat = BBOX.latMax - (y / (SAMPLE_RES - 1)) * (BBOX.latMax - BBOX.latMin);
      tasks.push({ idx: y * SAMPLE_RES + x, lat, lng });
    }
  }

  const results = new Array(tasks.length).fill(null);

  // Worker-pool pattern: CONCURRENCY threads each pull tasks off the list.
  let cursor = 0;
  const next = () => tasks[cursor++] || null;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (true) {
        const t = next();
        if (!t) return;
        results[t.idx] = await fetchSample(t.lat, t.lng);
      }
    })
  );

  let validCount = 0;
  let minM = Infinity, maxM = -Infinity;
  for (const v of results) {
    if (v != null && Number.isFinite(v)) {
      validCount++;
      if (v < minM) minM = v;
      if (v > maxM) maxM = v;
    }
  }

  if (validCount < tasks.length * MIN_VALID_FRAC) {
    console.warn(`[dem] EPQS too lossy (${validCount}/${tasks.length}); skipping real DEM`);
    return null;
  }

  // Fill gaps with neighbour average
  const filled = fillGaps(results, SAMPLE_RES);

  // 3. Cache
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify({
    heights: filled,
    minM, maxM,
    sampleRes: SAMPLE_RES,
    bbox: BBOX,
    fetchedAt: Date.now(),
  }));

  const elapsed = Date.now() - t0;
  console.log(`[dem] cached USGS heightmap: ${minM.toFixed(0)}m – ${maxM.toFixed(0)}m, ${validCount}/${tasks.length} valid samples in ${elapsed} ms`);

  return resampleAndNormalize(filled, minM, maxM);
}

async function fetchSample(lat, lng) {
  try {
    const res = await fetch(EPQS_URL(lat, lng), { timeout: 6000 });
    if (!res.ok) return null;
    const data = await res.json();
    // EPQS returns value as a string ("366.199645996"); coerce.
    const v = parseFloat(data?.value);
    return Number.isFinite(v) && v > -1000 ? v : null;
  } catch {
    return null;
  }
}

function fillGaps(arr, res) {
  const out = arr.slice();
  for (let i = 0; i < out.length; i++) {
    if (out[i] != null) continue;
    // Average over 4 neighbours that exist
    const x = i % res, y = Math.floor(i / res);
    let sum = 0, n = 0;
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= res || ny >= res) continue;
      const v = arr[ny * res + nx];
      if (v != null) { sum += v; n++; }
    }
    out[i] = n > 0 ? sum / n : 0;
  }
  return out;
}

// Bilinear-resample SAMPLE_RES×SAMPLE_RES → TARGET_RES×TARGET_RES and
// normalise to [0, 1] so it slots into the existing CA / TerrainMesh
// pipeline that expects a normalised heightmap.
function resampleAndNormalize(heights, minM, maxM) {
  const range = (maxM - minM) || 1;
  const out = new Float32Array(TARGET_RES * TARGET_RES);
  for (let y = 0; y < TARGET_RES; y++) {
    for (let x = 0; x < TARGET_RES; x++) {
      const fx = (x / (TARGET_RES - 1)) * (SAMPLE_RES - 1);
      const fy = (y / (TARGET_RES - 1)) * (SAMPLE_RES - 1);
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(SAMPLE_RES - 1, x0 + 1);
      const y1 = Math.min(SAMPLE_RES - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const a = heights[y0 * SAMPLE_RES + x0];
      const b = heights[y0 * SAMPLE_RES + x1];
      const c = heights[y1 * SAMPLE_RES + x0];
      const d = heights[y1 * SAMPLE_RES + x1];
      const elev = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      out[y * TARGET_RES + x] = (elev - minM) / range;
    }
  }
  return out;
}
