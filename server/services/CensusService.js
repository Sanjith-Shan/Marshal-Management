// CensusService — pulls real ACS 5-year (2022) population numbers for the
// communities the demo depicts, so the UI can show "Synthetic scenario:
// 3,200 residents · Real Poway, CA: 47,876 residents (ACS 2022)" and the
// AI advisor can reference real-world scale.
//
// Without CENSUS_API_KEY the service stays silent and the rest of the
// demo runs unchanged. The Census API is free and the key extends the
// rate limit; basic queries also work without one but are throttled.

import { EventEmitter } from 'events';
import fetch from 'node-fetch';

const ACS_BASE = 'https://api.census.gov/data/2022/acs/acs5';
const POP_VAR = 'B01001_001E';
const REFRESH_MS = 24 * 60 * 60 * 1000;   // 24 h — population doesn't change fast

// California (state:06) communities our scenario references. Place codes
// from Census Tiger/LINE 2022. Scripps Ranch is a neighborhood inside
// San Diego (not a separate CDP), so it isn't queryable as a Census place;
// the demo references it via the city total instead.
const TARGETS = [
  { key: 'sanDiegoCounty', label: 'San Diego County',     kind: 'county', code: '073' },
  { key: 'sanDiegoCity',   label: 'San Diego, CA',        kind: 'place',  code: '66000' },
  { key: 'poway',          label: 'Poway, CA',            kind: 'place',  code: '58520' },
  { key: 'escondido',      label: 'Escondido, CA',        kind: 'place',  code: '22678' },
];

export class CensusService extends EventEmitter {
  constructor() {
    super();
    this.current = { available: false, populations: {}, fetchedAt: 0 };
    this.timer = null;
  }

  async start() {
    if (process.env.MM_FORCE_MOCK === '1') {
      console.log('[census] disabled (MM_FORCE_MOCK=1)');
      return;
    }
    await this.refresh();
    this.timer = setInterval(() => this.refresh().catch(() => {}), REFRESH_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh() {
    const key = process.env.CENSUS_API_KEY;
    const populations = {};
    let anySuccess = false;
    for (const t of TARGETS) {
      try {
        const url = this._buildUrl(t, key);
        const res = await fetch(url, { timeout: 8000 });
        if (!res.ok) throw new Error(`census ${res.status}`);
        const data = await res.json();
        // data shape: [[ "NAME", "B01001_001E", "state", "...code..." ], [ "name", "12345", ... ]]
        if (!Array.isArray(data) || data.length < 2) continue;
        const valueIdx = data[0].indexOf(POP_VAR);
        const nameIdx  = data[0].indexOf('NAME');
        const row = data[1];
        const pop = parseInt(row[valueIdx], 10);
        if (Number.isFinite(pop)) {
          populations[t.key] = {
            label: t.label,
            name: row[nameIdx],
            population: pop,
          };
          anySuccess = true;
        }
      } catch (err) {
        console.warn(`[census] ${t.key} fetch failed:`, err.message);
      }
    }
    // Tract-level: aggregate stats for all San Diego County tracts
    let tracts = null;
    try {
      tracts = await this._fetchTracts(key);
    } catch (err) {
      console.warn('[census] tract fetch failed:', err.message);
    }

    if (anySuccess || tracts) {
      this.current = {
        available: true,
        populations,
        tracts,
        fetchedAt: Date.now(),
        source: 'ACS 2022 5-year',
      };
      this.emit('update', this.current);
      const list = Object.values(populations)
        .map(p => `${p.label}: ${p.population.toLocaleString()}`)
        .join(' · ');
      console.log(`[census] real population data loaded — ${list}${tracts ? ` · ${tracts.count} tracts (median ${tracts.medianPop.toLocaleString()})` : ''}`);
    } else {
      console.log('[census] no community data retrieved');
    }
  }

  async _fetchTracts(key) {
    const params = new URLSearchParams();
    params.set('get', `NAME,${POP_VAR}`);
    params.set('for', 'tract:*');
    params.set('in', 'state:06 county:073');
    if (key) params.set('key', key);
    const url = `${ACS_BASE}?${params.toString()}`;
    const res = await fetch(url, { timeout: 12000 });
    if (!res.ok) throw new Error(`census tract ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length < 2) return null;
    const valueIdx = data[0].indexOf(POP_VAR);
    const pops = [];
    for (let i = 1; i < data.length; i++) {
      const v = parseInt(data[i][valueIdx], 10);
      if (Number.isFinite(v) && v >= 0) pops.push(v);
    }
    if (!pops.length) return null;
    pops.sort((a, b) => a - b);
    const total = pops.reduce((a, p) => a + p, 0);
    return {
      count: pops.length,
      totalPop: total,
      medianPop: pops[Math.floor(pops.length / 2)],
      maxPop: pops[pops.length - 1],
      minPop: pops[0],
    };
  }

  _buildUrl(t, key) {
    const params = new URLSearchParams();
    params.set('get', `NAME,${POP_VAR}`);
    if (t.kind === 'county') {
      params.set('for', `county:${t.code}`);
      params.set('in', 'state:06');
    } else if (t.kind === 'place') {
      params.set('for', `place:${t.code}`);
      params.set('in', 'state:06');
    }
    if (key) params.set('key', key);
    return `${ACS_BASE}?${params.toString()}`;
  }
}
