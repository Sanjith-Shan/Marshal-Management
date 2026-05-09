import { Panel } from './Panel.js';

export class EvacuationPanel extends Panel {
  constructor(layer, position) {
    super(layer, 'EVACUATION STATUS', position);
    this._roads = { motorway: null, trunk: null };  // populated from scenario
    this.body.innerHTML = `
      <div id="ev-historical" style="display:none;background:rgba(255,184,107,0.06);border-left:2px solid var(--accent-warm);padding:8px 10px;margin-bottom:10px;border-radius:0 6px 6px 0;font-size:11px;line-height:1.45"></div>
      <div id="ev-census" style="display:none;background:rgba(94,234,141,0.06);border-left:2px solid var(--accent-good);padding:8px 10px;margin-bottom:10px;border-radius:0 6px 6px 0;font-size:11px;line-height:1.55"></div>
      <div id="ev-overview" class="metric-grid"></div>
      <h3>ZONES</h3>
      <div id="ev-zones"></div>
      <h3>SHELTERS</h3>
      <div id="ev-shelters"></div>
      <h3>BOTTLENECKS</h3>
      <div id="ev-bot" style="font-size:11px;color:var(--text-dim)">—</div>
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
    el.innerHTML = `
      <div style="font-weight:700;letter-spacing:0.08em;color:var(--accent-good);margin-bottom:4px">
        REAL POPULATION (US Census ACS 2022)
      </div>
      ${items}
    `;
    el.style.display = 'block';
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
    const stats = [];
    if (meta.acresBurned)    stats.push(`${meta.acresBurned.toLocaleString()} acres`);
    if (meta.fatalities)     stats.push(`${meta.fatalities} fatalities`);
    if (meta.homesDestroyed) stats.push(`${meta.homesDestroyed.toLocaleString()} homes lost`);
    if (meta.evacuated)      stats.push(`${meta.evacuated.toLocaleString()} evacuated`);
    el.innerHTML = `
      <div style="font-weight:700;letter-spacing:0.08em;color:var(--accent-warm);margin-bottom:4px">
        ${scenario.scenarioName} · ${meta.realDate}
      </div>
      <div style="color:var(--text-dim);margin-bottom:5px">${stats.join(' · ')}</div>
      <div>${meta.summary || ''}</div>
      ${meta.windDuringEvent ? `<div style="margin-top:4px;color:var(--text-dim)">Wind: ${meta.windDuringEvent}</div>` : ''}
    `;
    el.style.display = 'block';
  }
  update(ev, snap) {
    if (!ev) return;
    const $ = (id) => this.body.querySelector('#' + id);
    const overview = $('ev-overview');
    const evacuated = ev.zones.reduce((a, z) => a + (z.evacuatedPct || 0), 0) / Math.max(1, ev.zones.length);
    overview.innerHTML = `
      <div class="metric"><span class="metric-label">Pop</span><span class="metric-val">${ev.totalPopulation.toLocaleString()}</span></div>
      <div class="metric"><span class="metric-label">Evacuated</span><span class="metric-val good">${Math.round(evacuated)}%</span></div>
      <div class="metric"><span class="metric-label">Bottlenecks</span><span class="metric-val ${ev.bottlenecks.length ? 'warn' : ''}">${ev.bottlenecks.length}</span></div>
      <div class="metric"><span class="metric-label">Roads Lost</span><span class="metric-val ${ev.lostRoads ? 'bad' : ''}">${ev.lostRoads || 0}</span></div>
    `;

    const zonesEl = $('ev-zones');
    zonesEl.innerHTML = ev.zones.map(z => {
      const lvlText = z.level === 3 ? 'LEVEL 3 GO' : z.level === 2 ? 'LEVEL 2 SET' : 'LEVEL 1 READY';
      const dests = z.route?.destinations
        ? z.route.destinations.slice(0, 2).map(d => `${d.name} (${d.count})`).join(', ')
        : null;
      const bn = z.bottleneck
        ? `<div class="zone-meta" style="color:var(--accent-warm)">⚠ Bottleneck · ${z.bottleneck.ratio}% cap — voice: "Contraflow ${this._roads.motorway || 'primary route'}"</div>`
        : '';
      const hint = zoneActionHint(z, this._roads);
      const segCount = z.route?.edgeIds?.length || 0;
      const altCount = z.route?.secondaryEdgeIds?.length || 0;
      const segInfo = segCount
        ? `<span style="color:var(--text-dim);font-size:10px">· ${segCount} seg${altCount ? ` (+${altCount} alt)` : ''}</span>`
        : '';
      const destLine = dests
        ? `<div class="zone-meta" style="color:var(--text-dim)">→ ${dests} ${segInfo}</div>`
        : `<div class="zone-meta" style="color:var(--accent-hot)">⚠ No route found</div>`;
      return `<div class="zone-row l${z.level}">
        <div class="zone-name">
          <span>${z.name}</span>
          <span class="zone-level l${z.level}">${lvlText}</span>
        </div>
        <div class="zone-meta">Fire ETA ${formatMin(z.etaMin)} · Evac ${formatMin(z.evacMin)} · Margin ${formatMin(z.marginMin)}</div>
        ${destLine}
        ${bn}
        ${hint}
        <div class="progress"><div class="progress-fill" style="width:${z.evacuatedPct || 0}%"></div></div>
      </div>`;
    }).join('');

    const sheltersEl = $('ev-shelters');
    const usage = ev.shelterUsage || [];
    sheltersEl.innerHTML = usage.map(s => {
      const pct = Math.round((s.used / s.capacity) * 100);
      return `<div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;padding:4px 0">
        <span>${s.name}</span>
        <span style="color:var(--text-dim)">${s.used}/${s.capacity} <span style="color:${pct>85?'var(--accent-hot)':pct>60?'var(--accent-warm)':'var(--accent-good)'}">${pct}%</span></span>
      </div>`;
    }).join('') || '<span style="color:var(--text-dim)">No shelters in use</span>';

    const botEl = $('ev-bot');
    if (ev.bottlenecks.length === 0) {
      botEl.innerHTML = '<span style="color:var(--accent-good)">All routes flowing within capacity.</span>';
    } else {
      botEl.innerHTML = ev.bottlenecks.slice(0, 4).map(b =>
        `Edge ${b.edgeId} (${b.hwy}) · ${Math.round(b.ratio * 100)}% cap`
      ).join('<br>');
    }
  }
}

function formatMin(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 999) return '—';
  if (n < 0) return `<span style="color:var(--accent-hot)">${n}m</span>`;
  return `${n}m`;
}

function zoneActionHint(z, roads = {}) {
  const s = (cls, text) =>
    `<div style="font-size:10px;padding:3px 6px;margin-top:3px;border-radius:3px;background:${cls === 'crit' ? 'rgba(255,59,48,0.12)' : cls === 'warn' ? 'rgba(255,149,0,0.12)' : 'rgba(94,234,141,0.08)'};color:${cls === 'crit' ? 'var(--accent-hot)' : cls === 'warn' ? 'var(--accent-warm)' : 'var(--accent-good)'};letter-spacing:0.04em">${text}</div>`;

  const hwy = roads.motorway || roads.trunk || 'primary route';

  if (!z.route) {
    if (z.level >= 2) return s('crit', `⚡ NO ROUTE — press M → COMMAND, unblock roads or voice: "Contraflow ${hwy}"`);
    return s('warn', '⚠ No route computed — press E to run evacuation engine');
  }
  if (z.marginMin < 0) {
    return s('crit', '⚡ Fire arrival imminent — maximize contraflow, push remaining evacuees now');
  }
  if (z.marginMin < 15 && z.level < 3) {
    return s('crit', `⚡ Margin critical — click zone or voice: "Upgrade ${z.name} to GO"`);
  }
  if (z.bottleneck && z.bottleneck.ratio > 100) {
    return s('warn', `→ Route overloaded — voice: "Contraflow ${hwy}" or "Block alternate roads"`);
  }
  if (z.level < 3 && z.marginMin < 45) {
    return s('warn', `→ Margin tightening — consider upgrading to LEVEL ${z.level + 1}`);
  }
  if (z.level === 3 && (z.evacuatedPct || 0) > 80) {
    return s('ok', `✓ ${z.evacuatedPct}% clear — monitor for stragglers`);
  }
  return '';
}
