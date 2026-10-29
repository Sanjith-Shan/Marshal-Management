import { Panel } from './Panel.js';

export class EvacuationPanel extends Panel {
  constructor(layer, position) {
    super(layer, 'Evacuation', position);
    this._roads = { motorway: null, trunk: null };  // populated from scenario
    this._lastEv = null;
    this._simTimeMin = 0;
    this.body.innerHTML = `
      <div id="ev-historical" class="context-line" style="display:none"></div>
      <div id="ev-census" style="display:none"></div>
      <div id="ev-overview" class="metric-grid"></div>
      <h3>Zones</h3>
      <div id="ev-zones"></div>
      <h3>Shelters</h3>
      <div id="ev-shelters"></div>
      <h3>Bottlenecks</h3>
      <div id="ev-bot"></div>
    `;
  }
  setCensusContext(census) {
    if (!census?.available || !census.populations) return;
    const el = this.body.querySelector('#ev-census');
    if (!el) return;
    const order = ['sanDiegoCounty', 'sanDiegoCity', 'poway', 'escondido'];
    const items = order
      .filter(k => census.populations[k])
      .map(k => `<div style="display:flex;justify-content:space-between"><span>${census.populations[k].label}</span><span style="color:var(--accent-good)">${census.populations[k].population.toLocaleString()}</span></div>`)
      .join('');
    const tractLine = census.tracts
      ? `<div style="margin-top:5px;padding-top:5px;border-top:1px dashed rgba(94,234,141,0.18);font-size:10px;color:var(--text-dim)">${census.tracts.count} census tracts · median ${census.tracts.medianPop.toLocaleString()} residents · largest ${census.tracts.maxPop.toLocaleString()}</div>`
      : '';
    el.innerHTML = `
      <div style="font-weight:700;letter-spacing:0.08em;color:var(--accent-good);margin-bottom:4px">
        REAL POPULATION (US Census ACS 2022)
      </div>
      ${items}
      ${tractLine}
    `;
    el.style.display = 'none';
  }

  setScenarioRoads(scenario) {
    // Derive road labels from the actual edge types in this scenario.
    // Motorway class → "I-15", trunk class → "SR-67" per Cedar Corridor convention.
    // If no motorway exists, falls back to null and hints omit the road name.
    const edges = scenario?.edges || [];
    const hasMotorway = edges.some(e => e.hwy === 'motorway');
    const hasTrunk    = edges.some(e => e.hwy === 'trunk');
    this._roads = {
      motorway: hasMotorway ? 'I-15'  : null,
      trunk:    hasTrunk    ? 'SR-67' : null,
      primary:  edges.some(e => e.hwy === 'primary') ? 'primary roads' : null
    };
  }

  setHistoricalContext(scenario) {
    const el = this.body.querySelector('#ev-historical');
    if (!el) return;
    const meta = scenario?.scenarioMeta;
    if (!meta || meta.realDate === 'fictional') {
      el.style.display = 'none';
      return;
    }
    const acres = meta.acresBurned ? `${meta.acresBurned.toLocaleString()} acres` : '';
    el.innerHTML = `<span><b>${scenario.scenarioName}</b></span><span>${acres}</span>`;
    el.style.display = 'flex';
  }
  setSimTime(min) {
    this._simTimeMin = min;
    if (this._lastEv) this._renderOverview(this._lastEv);
  }

  update(ev, snap) {
    if (!ev) return;
    this._lastEv = ev;
    this._renderOverview(ev);
    this._renderZones(ev);
    this._renderShelters(ev);
    this._renderBottlenecks(ev);
  }

  _liveEvacuatedPct(z, lastRunSimMin) {
    if (!z.evacMin || z.evacMin <= 0) return z.evacuatedPct || 0;
    if (z.level < 2) return 0;
    const elapsed = Math.max(0, this._simTimeMin - (lastRunSimMin || 0));
    return Math.min(100, Math.round((elapsed / z.evacMin) * 100));
  }

  _renderOverview(ev) {
    const el = this.body.querySelector('#ev-overview');
    if (!el) return;
    const lrs = ev.lastRunSimMin || 0;

    // Weighted evacuated % across GO zones using live sim-clock progress
    let totalPop = 0, totalEvacPop = 0;
    for (const z of ev.zones) {
      const pop = z.population || 0;
      totalPop += pop;
      if (z.level >= 2) {
        totalEvacPop += pop * this._liveEvacuatedPct(z, lrs) / 100;
      }
    }
    // Fall back to engine's routed count until any zone is active
    const hasActiveZones = ev.zones.some(z => z.level >= 2);
    let evacPct;
    if (!hasActiveZones) {
      // Nobody has been ordered out yet; routed capacity is not people moved.
      evacPct = 0;
    } else {
      evacPct = Math.round(totalEvacPop / Math.max(1, totalPop) * 100);
    }
    this.lastEvacPct = evacPct;
    const evacDisplay = evacPct == null ? '—'
      : `<span class="${evacPct >= 60 ? 'good' : evacPct >= 30 ? '' : 'bad'}">${evacPct}%</span>`;

    const fireRoads = ev.fireBlockedRoads || 0;
    const userRoads = ev.lostRoads || 0;
    const totalLost = fireRoads + userRoads;
    const lostTip = fireRoads && userRoads
      ? `${fireRoads} fire + ${userRoads} blocked`
      : fireRoads ? `${fireRoads} fire-reached`
      : userRoads ? `${userRoads} manually blocked` : '';
    const lostDisplay = totalLost
      ? `<span class="bad" title="${lostTip}">${totalLost}</span>`
      : `<span>0</span>`;

    el.innerHTML = `
      <div class="metric"><span class="metric-label">Residents</span><span class="metric-val">${ev.totalPopulation.toLocaleString()}</span></div>
      <div class="metric"><span class="metric-label">Evacuated</span><span class="metric-val">${evacDisplay}</span></div>
      <div class="metric"><span class="metric-label">Bottlenecks</span><span class="metric-val ${ev.bottlenecks.length ? 'warn' : ''}">${ev.bottlenecks.length}</span></div>
      <div class="metric"><span class="metric-label">Roads lost</span><span class="metric-val">${lostDisplay}</span></div>
    `;
  }

  _renderZones(ev) {
    const zonesEl = this.body.querySelector('#ev-zones');
    if (!zonesEl) return;
    const lrs = ev.lastRunSimMin || 0;
    zonesEl.innerHTML = ev.zones.map(z => {
      const lvlText = z.level === 3 ? 'GO' : z.level === 2 ? 'SET' : 'READY';
      const hint = zoneActionHint(z, this._roads);
      const livePct = this._liveEvacuatedPct(z, lrs);
      const dest = z.route?.destinations?.[0]?.name;
      return `<div class="zone-row l${z.level}">
        <div class="zone-name">
          <span>${z.name}</span>
          <span class="zone-level l${z.level}">${lvlText}</span>
        </div>
        <div class="zone-stats">
          <div class="zone-stat"><span>Fire ETA</span><span>${formatMin(z.etaMin)}</span></div>
          <div class="zone-stat"><span>Clear in</span><span>${formatMin(z.evacMin)}</span></div>
          <div class="zone-stat"><span>Margin</span><span>${formatMin(z.marginMin)}</span></div>
        </div>
        ${dest ? `<div class="zone-meta">To ${dest}</div>` : `<div class="zone-meta" style="color:#ff8a80">No route found</div>`}
        ${hint}
        <div class="progress"><div class="progress-fill" style="width:${livePct}%"></div></div>
      </div>`;
    }).join('');
  }

  _renderShelters(ev) {
    const sheltersEl = this.body.querySelector('#ev-shelters');
    if (!sheltersEl) return;
    const usage = ev.shelterUsage || [];
    sheltersEl.innerHTML = usage.map(s => {
      const pct = s.capacity > 0 ? Math.round((s.used / s.capacity) * 100) : 0;
      const col = pct > 85 ? 'var(--accent-hot)' : pct > 60 ? 'var(--accent-warm)' : 'var(--text-dim)';
      return `<div class="list-row"><span>${s.name}</span><span class="num" style="color:${col}">${pct}%</span></div>`;
    }).join('') || '<div class="list-row"><span style="color:var(--text-dim)">No shelters in use</span></div>';
  }

  _renderBottlenecks(ev) {
    const botEl = this.body.querySelector('#ev-bot');
    if (!botEl) return;
    if (!ev.bottlenecks.length) {
      botEl.innerHTML = '<div class="list-row"><span style="color:var(--accent-good)">All routes within capacity</span></div>';
    } else {
      botEl.innerHTML = ev.bottlenecks.slice(0, 4).map(b => {
        const pct = Math.round(b.ratio * 100);
        const roadName = b.name || (b.hwy ? b.hwy.charAt(0).toUpperCase() + b.hwy.slice(1) : `Road ${b.edgeId}`);
        const sev = pct > 150 ? 'var(--accent-hot)' : pct > 110 ? 'var(--accent-warm)' : 'var(--text-dim)';
        return `<div class="list-row"><span>${roadName}</span><span class="num" style="color:${sev}">${pct}%</span></div>`;
      }).join('');
    }
  }
}

function formatMin(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 999) return '—';
  const t = (m) => {
    const a = Math.abs(m);
    return a >= 120 ? `${Math.round(a / 60)} h` : `${a} min`;
  };
  if (n < 0) return `<span class="bad">−${t(n)}</span>`;
  return t(n);
}

function zoneActionHint(z, roads = {}) {
  const s = (cls, text) => `<div class="zone-hint ${cls}">${text}</div>`;
  const hwy = roads.motorway || roads.trunk || 'the main route';

  if (!z.route) {
    if (z.level >= 2) return s('crit', `No open route. Reopen roads or run contraflow on ${hwy}`);
    return '';
  }
  if (z.marginMin < 0) return s('crit', 'Fire arrives before the zone clears. Push contraflow now');
  if (z.marginMin < 15 && z.level < 3) return s('crit', 'Margin critical. Raise to GO');
  if (z.bottleneck && z.bottleneck.ratio > 100) return s('warn', `Route over capacity. Contraflow on ${hwy}`);
  if (z.level === 3 && (z.evacuatedPct || 0) > 80) return s('ok', `${z.evacuatedPct}% clear`);
  return '';
}
