// PerimeterService — fetches the real 2003 Cedar Fire (and 2007 Witch Creek)
// burn perimeter from NIFC's InterAgencyFirePerimeterHistory feature service,
// projects every coordinate into our grid via latLngToGrid, and caches the
// result as a flat polygons[] array of { gx, gy } points the client can
// render directly with terrain.gridToWorld.
//
// On any failure (offline, schema change, no matching feature) we return
// null and the renderer simply doesn't draw anything — no crash.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fetch from 'node-fetch';

import { latLngToGrid } from './ScenarioBuilder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, '../../data');

// NIFC public ArcGIS REST service. Feature layer 0 holds historical
// perimeters by year. Filtering by incident name + fire year returns
// the polygon(s) for the named fire.
const NIFC_BASE = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/InterAgencyFirePerimeterHistory_All_Years_View/FeatureServer/0/query';

const PRESETS = {
  cedar: {
    cacheFile: 'perimeter-cedar.json',
    where: "INCIDENT='CEDAR' AND FIRE_YEAR=2003",
    label: '2003 Cedar Fire (NIFC)',
  },
  witch: {
    cacheFile: 'perimeter-witch.json',
    where: "INCIDENT='WITCH' AND FIRE_YEAR=2007",
    label: '2007 Witch Creek Fire (NIFC)',
  },
};

export async function loadPerimeter(scenarioId, { forceRefetch = false } = {}) {
  if (process.env.MM_FORCE_MOCK === '1' || process.env.PERIM_DISABLED === '1') {
    return null;
  }
  const preset = PRESETS[scenarioId];
  if (!preset) return null;
  const cachePath = path.resolve(CACHE_DIR, preset.cacheFile);

  if (!forceRefetch) {
    try {
      const buf = await fs.readFile(cachePath, 'utf8');
      const cached = JSON.parse(buf);
      if (cached?.polygons?.length) {
        console.log(`[perim] using cached ${preset.label} (${cached.polygons.length} polygon${cached.polygons.length === 1 ? '' : 's'})`);
        return cached;
      }
    } catch {
      // cache miss → fetch
    }
  }

  // Build query URL
  const params = new URLSearchParams({
    where: preset.where,
    outFields: 'INCIDENT,FIRE_YEAR,GIS_ACRES',
    returnGeometry: 'true',
    geometryPrecision: '5',
    outSR: '4326',
    f: 'geojson',
  });
  const url = `${NIFC_BASE}?${params.toString()}`;

  try {
    console.log(`[perim] fetching ${preset.label} from NIFC…`);
    const res = await fetch(url, { timeout: 30_000 });
    if (!res.ok) throw new Error(`NIFC ${res.status}`);
    const geojson = await res.json();
    const polygons = extractPolygons(geojson);
    if (!polygons.length) {
      console.warn(`[perim] no polygons returned for ${preset.label}`);
      return null;
    }
    let totalAcres = 0;
    for (const f of geojson.features || []) {
      const a = f?.properties?.GIS_ACRES;
      if (typeof a === 'number') totalAcres += a;
    }
    const result = {
      label: preset.label,
      polygons,
      acres: Math.round(totalAcres),
      fetchedAt: Date.now(),
    };
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(result));
    console.log(`[perim] cached ${preset.label}: ${polygons.length} polygon${polygons.length === 1 ? '' : 's'}, ${result.acres.toLocaleString()} acres`);
    return result;
  } catch (err) {
    console.warn(`[perim] fetch failed for ${preset.label}:`, err.message);
    return null;
  }
}

function extractPolygons(geojson) {
  // NIFC returns one feature per agency/daily record. Many are tiny incident
  // reports (3–4 point polygons). Filter to polygons with enough points to
  // represent a real burn area; sort largest first so the renderer draws
  // the main footprint over any smaller satellite areas.
  const out = [];
  for (const feat of geojson?.features || []) {
    const g = feat.geometry;
    const acres = feat?.properties?.GIS_ACRES || 0;
    if (!g) continue;
    if (g.type === 'Polygon') {
      out.push({ ring: ringToGrid(g.coordinates[0]), acres });
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) {
        out.push({ ring: ringToGrid(poly[0]), acres });
      }
    }
  }
  return out
    .filter(p => p.ring.length >= 10)
    .sort((a, b) => b.acres - a.acres || b.ring.length - a.ring.length)
    .map(p => p.ring);
}

function ringToGrid(ring) {
  const out = [];
  for (const [lng, lat] of ring) {
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const { gx, gy } = latLngToGrid(lat, lng);
    out.push({ gx, gy });
  }
  return out;
}
