// FIRMSService — pulls live NASA FIRMS active fire detections for a bounding
// box. Used to surface "real wildfires currently burning in California" as
// context for the AI advisor and a HUD badge. Caches for 30 min to stay well
// under FIRMS' fair-use limits.
//
// Without FIRMS_MAP_KEY the service stays silent and the rest of the system
// runs with no live-fire context — just the procedural CA simulation.

import { EventEmitter } from 'events';
import fetch from 'node-fetch';

const REFRESH_MS = 30 * 60 * 1000;
const CALIFORNIA_BBOX = '-125,32,-114,42';   // west,south,east,north
const SOURCE = 'VIIRS_SNPP_NRT';
const DAY_RANGE = 1;

export class FIRMSService extends EventEmitter {
  constructor() {
    super();
    this.current = { available: false, count: 0, hotspots: [], fetchedAt: 0 };
    this.timer = null;
    this.failures = 0;
  }

  async start() {
    if (!process.env.FIRMS_MAP_KEY || process.env.MM_FORCE_MOCK === '1') {
      console.log('[firms] disabled (no key or MM_FORCE_MOCK=1)');
      return;
    }
    await this.refresh();
    this.timer = setInterval(() => this.refresh().catch(() => {}), REFRESH_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh() {
    const key = process.env.FIRMS_MAP_KEY;
    if (!key) return;
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${SOURCE}/${CALIFORNIA_BBOX}/${DAY_RANGE}`;
    try {
      const res = await fetch(url, { timeout: 12000 });
      if (!res.ok) throw new Error(`FIRMS ${res.status}`);
      const text = await res.text();
      const hotspots = parseFirmsCsv(text);
      this.current = {
        available: true,
        count: hotspots.length,
        hotspots: hotspots.slice(0, 50),    // cap broadcast payload
        bbox: CALIFORNIA_BBOX,
        source: SOURCE,
        fetchedAt: Date.now()
      };
      this.failures = 0;
      this.emit('update', this.current);
      console.log(`[firms] ${hotspots.length} active hotspots in California (source: ${SOURCE})`);
    } catch (err) {
      this.failures += 1;
      console.warn('[firms] refresh failed:', err.message);
    }
  }
}

function parseFirmsCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const header = lines[0].split(',');
  const idx = (name) => header.indexOf(name);
  const iLat = idx('latitude'), iLng = idx('longitude'), iBri = idx('bright_ti4') >= 0 ? idx('bright_ti4') : idx('brightness');
  const iDate = idx('acq_date'), iTime = idx('acq_time'), iConf = idx('confidence'), iFrp = idx('frp');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    if (cells.length < header.length) continue;
    out.push({
      lat: parseFloat(cells[iLat]),
      lng: parseFloat(cells[iLng]),
      brightness: parseFloat(cells[iBri]),
      date: cells[iDate],
      time: cells[iTime],
      confidence: cells[iConf],
      frp: parseFloat(cells[iFrp]),
    });
  }
  return out;
}
