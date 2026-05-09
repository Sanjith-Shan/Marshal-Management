// AIAdvisor — OpenAI gpt-4o-mini if OPENAI_API_KEY is set, otherwise a
// rules-based mock that uses the same context format and returns equally
// useful, scenario-aware responses.

import OpenAI from 'openai';

const MODEL = 'gpt-4o-mini';   // fast, cheap, good quality for short advisor turns

const SYSTEM = `You are the AI Strategic Advisor for a fire-marshal AR command system.
You see the full state: fire, weather, terrain, road network, populations,
zones, evacuation routes, bottlenecks, shelter capacity. Respond in 2–4
short sentences. Be specific: name zones, roads, percentages, time
windows. If a critical risk exists (declining safety margin, blocked
evacuation route, shelter near capacity), lead with a single one-line
WARNING. Otherwise lead with a recommendation. Never fabricate data; only
reason from the context provided. Skip pleasantries.`;

export class AIAdvisor {
  constructor(state, weather) {
    this.state = state;
    this.weather = weather;
    this.client = null;
    this.model = null;
    this.history = [];
    this._redFlagAlerted = false;   // emit at most once per Red Flag event
    if (process.env.OPENAI_API_KEY && process.env.MM_FORCE_MOCK !== '1') {
      try {
        this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        this.model = MODEL;
      } catch (err) {
        console.warn('[ai] openai init failed:', err.message);
      }
    }
  }

  backendName() {
    return this.model ? this.model : 'mock-advisor';
  }

  // Detect imperative intents in a natural-language prompt and translate them
  // into the same { type, payload } actions the keyboard / hardware paths emit.
  // Returns { actions, summary }; caller is responsible for dispatching them.
  parseIntents(prompt) {
    if (!prompt) return { actions: [], summary: '' };
    const p = String(prompt).toLowerCase();
    const actions = [];
    const notes = [];

    // --- Zone level overrides ---
    const zoneTokens = [
      { match: /\b(?:scripps\s*ranch|scripps|zone\s*a)\b/,                 name: 'Scripps Ranch' },
      { match: /\b(?:poway|zone\s*b)\b/,                                    name: 'Poway' },
      { match: /\b(?:ramona|zone\s*c)\b/,                                   name: 'Ramona' },
      { match: /\b(?:mira\s*mesa|zone\s*d)\b/,                              name: 'Mira Mesa' },
      { match: /\b(?:rancho\s*pe(?:n|ñ)asquitos|penasquitos|zone\s*e)\b/,   name: 'Rancho Peñasquitos' },
      { match: /\b(?:la\s*jolla|ucsd|zone\s*f)\b/,                          name: 'La Jolla / UCSD' }
    ];
    // Require an explicit level token to avoid false positives like
    // "how ready is Poway?" or "is the team set?". Order: GO → READY → SET.
    let level = null;
    if (/\b(?:to\s+go|go\s+now|level\s*3|trigger\s+evac\w*|evacuate)\b/.test(p))    level = 3;
    else if (/\b(?:to\s+ready|level\s*1|stand\s*down|all\s*clear)\b/.test(p))       level = 1;
    else if (/\b(?:to\s+set|level\s*2|prepare\s+to\s+leave|stand\s*by)\b/.test(p))  level = 2;
    if (level != null) {
      const levelName = level === 3 ? 'GO' : level === 2 ? 'SET' : 'READY';
      for (const z of zoneTokens) {
        if (!z.match.test(p)) continue;
        const zone = this.state.evacuation.zones.find(zz => zz.name === z.name);
        if (!zone) continue;
        actions.push({ type: 'override-zone', payload: { zoneId: zone.id, level } });
        notes.push(`Set ${zone.name} to LEVEL ${level} ${levelName}.`);
      }
    }

    // --- Road actions: block / unblock / contraflow ---
    const roadTokens = [
      { match: /\b(?:i[-\s]?15|interstate\s*15|highway\s*15|motorway)\b/, label: 'I-15',  filter: e => e.hwy === 'motorway' },
      { match: /\b(?:sr[-\s]?67|state\s*route\s*67|highway\s*67|route\s*67|\btrunk\b)\b/, label: 'SR-67', filter: e => e.hwy === 'trunk' }
    ];
    for (const r of roadTokens) {
      if (!r.match.test(p)) continue;
      const matched = this.state.scenario.edges.filter(r.filter);
      if (!matched.length) continue;
      const wantsBlock    = /\b(?:block|close|shut(?:\s*down)?|stop\s*traffic)\b/.test(p);
      const wantsUnblock  = /\b(?:unblock|reopen|open\s+(?:up\s+)?(?:i[-\s]?15|sr[-\s]?67|highway|route|the))\b/.test(p);
      const wantsContra   = /\bcontraflow\b|\breverse\s*flow\b|\bflip\s*lanes\b/.test(p);
      const stopContra    = /\b(?:disable|stop|end|cancel)\s+contraflow\b/.test(p);
      if (wantsBlock) {
        for (const e of matched) actions.push({ type: 'block-road', payload: { edgeId: e.id, blocked: true } });
        notes.push(`Blocked ${r.label} (${matched.length} segments).`);
      } else if (wantsUnblock) {
        for (const e of matched) actions.push({ type: 'block-road', payload: { edgeId: e.id, blocked: false } });
        notes.push(`Reopened ${r.label}.`);
      }
      if (wantsContra) {
        const enabled = !stopContra;
        for (const e of matched) actions.push({ type: 'contraflow', payload: { edgeId: e.id, enabled } });
        notes.push(`${enabled ? 'Enabled' : 'Disabled'} contraflow on ${r.label}.`);
      }
    }

    return { actions, summary: notes.join(' ') };
  }

  buildContext() {
    const s = this.state;
    const lines = [];
    // Real-world historical context (Cedar 2003, Witch 2007)
    const meta = s.scenario.scenarioMeta;
    if (meta && meta.realDate && meta.realDate !== 'fictional') {
      lines.push(`HISTORICAL CONTEXT — ${s.scenario.scenarioName}:`);
      lines.push(`- Real event: ${meta.realDate}, started ${meta.ignitionTime || '—'}, cause: ${meta.cause || '—'}`);
      if (meta.acresBurned)    lines.push(`- ${meta.acresBurned.toLocaleString()} acres burned, ${meta.fatalities} fatalities, ${(meta.homesDestroyed||0).toLocaleString()} homes destroyed, ${(meta.evacuated||0).toLocaleString()} evacuated`);
      if (meta.windDuringEvent) lines.push(`- Wind during event: ${meta.windDuringEvent}`);
      if (meta.summary)         lines.push(`- ${meta.summary}`);
      lines.push(``);
    }
    lines.push(`Sim time: ${s.simTimeMin.toFixed(1)} min   Mode: ${s.mode}`);
    lines.push(`Weather: wind ${Math.round(s.weather.windKph)} kph from ${Math.round(s.weather.windDeg)}°, gusts ${Math.round(s.weather.gustKph)} kph, RH ${Math.round(s.weather.humidity)}%, ${s.weather.redFlag ? 'RED FLAG' : 'no flag'}`);
    lines.push(`Fire: ${s.fire.burningCells} burning cells, ${s.fire.burnedCells} burned, perimeter ${s.fire.perimeterCells}`);
    lines.push(``);
    lines.push(`ZONES:`);
    for (const z of s.evacuation.zones) {
      const lvl = z.level === 3 ? 'L3 GO' : z.level === 2 ? 'L2 SET' : 'L1 READY';
      const pop = s.scenario.populations
        .filter(p => p.zone === z.name)
        .reduce((a, p) => a + p.count, 0);
      lines.push(`- ${z.name}: ${lvl}  pop ${pop}  fire ETA ${z.etaMin}m  evac time ${z.evacMin}m  margin ${z.marginMin}m  evacuated ${z.evacuatedPct || 0}%`);
      if (z.bottleneck) lines.push(`    BOTTLENECK on edge ${z.bottleneck.edgeId} at ${z.bottleneck.ratio}% capacity`);
      if (z.route) {
        const dests = z.route.destinations.map(d => `${d.name}(${d.count})`).join(', ');
        lines.push(`    routing to: ${dests}`);
      }
    }
    lines.push(``);
    lines.push(`SHELTERS:`);
    const shelterUsage = (s.evacuation.lastRunAt ? this._shelterUsage() : []);
    for (const sh of s.scenario.shelters) {
      const u = shelterUsage.find(x => x.nodeId === sh.nodeId);
      lines.push(`- ${sh.name}: ${u ? u.used : 0}/${sh.capacity}`);
    }
    lines.push(``);
    lines.push(`ROAD STATUS:`);
    const blocked = s.scenario.edges.filter(e => e.blocked);
    const contra = s.scenario.edges.filter(e => e.contra);
    lines.push(`- ${blocked.length} blocked edges, ${contra.length} contraflow segments`);
    if (s.evacuation.bottlenecks.length) {
      const top = s.evacuation.bottlenecks.slice(0, 3)
        .map(b => `edge ${b.edgeId} (${Math.round(b.ratio * 100)}% cap)`).join(', ');
      lines.push(`- Top bottlenecks: ${top}`);
    }
    // Real-world context: ACS 2022 5-year population reference
    if (s.census?.available) {
      const pops = s.census.populations || {};
      const refs = ['sanDiegoCounty', 'sanDiegoCity', 'poway', 'escondido']
        .filter(k => pops[k])
        .map(k => `${pops[k].label} ${pops[k].population.toLocaleString()}`);
      if (refs.length) {
        lines.push(``);
        lines.push(`REAL-WORLD POPULATION REFERENCE (US Census ACS 2022):`);
        lines.push(`- ${refs.join(' · ')}`);
        if (s.census.tracts) {
          const t = s.census.tracts;
          lines.push(`- ${t.count} census tracts in San Diego County (median ${t.medianPop.toLocaleString()} residents/tract, max ${t.maxPop.toLocaleString()})`);
        }
        lines.push(`- Synthetic scenario population (${s.evacuation.totalPopulation.toLocaleString()}) is scaled down for routing-engine performance.`);
      }
    }
    // Real-world context: live NASA FIRMS California wildfire hotspots
    if (s.firms?.available && s.firms.count > 0) {
      lines.push(``);
      lines.push(`LIVE STATEWIDE FIRE ACTIVITY (NASA FIRMS, last 24 h):`);
      lines.push(`- ${s.firms.count} active satellite-detected hotspots in California`);
      if (s.firms.hotspots?.length) {
        const top = s.firms.hotspots.slice(0, 3)
          .map(h => `(${h.lat?.toFixed(2)}, ${h.lng?.toFixed(2)}) FRP ${h.frp || '?'}`)
          .join(', ');
        lines.push(`- Top by location: ${top}`);
      }
    }
    return lines.join('\n');
  }

  _shelterUsage() {
    const used = new Map();
    for (const z of this.state.evacuation.zones) {
      if (!z.route) continue;
      for (const d of z.route.destinations) {
        used.set(d.name, (used.get(d.name) || 0) + d.count);
      }
    }
    return this.state.scenario.shelters.map(s => ({
      nodeId: s.nodeId, used: used.get(s.name) || 0
    }));
  }

  async ask(prompt) {
    const ctx = this.buildContext();
    if (this.client && this.model) {
      try {
        const completion = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user',   content: `CONTEXT:\n${ctx}\n\nMARSHAL: ${prompt}` }
          ],
          max_tokens: 220,
          temperature: 0.25,    // factual, not creative
        });
        const text = (completion.choices?.[0]?.message?.content || '').trim();
        if (text) {
          return {
            severity: this._severity(text),
            source: 'AI',
            text,
            prompt
          };
        }
      } catch (err) {
        console.warn('[ai] openai failed, falling back:', err.message);
      }
    }
    return this._mockReply(prompt, ctx);
  }

  async proactiveScan() {
    const s = this.state;
    const issues = [];

    // Red Flag conditions: emit once per event (reset when flag clears).
    if (s.weather.redFlag) {
      if (!this._redFlagAlerted) {
        this._redFlagAlerted = true;
        issues.push({
          severity: 'warn',
          source: 'proactive',
          text: `RED FLAG conditions active — wind ${Math.round(s.weather.windKph)} kph from ${Math.round(s.weather.windDeg)}°, RH ${Math.round(s.weather.humidity)}%. Fire spread will be rapid and unpredictable. Recommend preemptive zone upgrades and contraflow on primary evacuation routes.`
        });
      }
    } else {
      this._redFlagAlerted = false;
    }

    // Zone-level issues (higher priority, may override Red Flag in sort).
    for (const z of s.evacuation.zones) {
      if (!z.route && z.level >= 2) {
        issues.push({
          severity: 'crit',
          source: 'proactive',
          zoneName: z.name,
          text: `${z.name} has NO evacuation route — all roads blocked or burned. Switch to COMMAND mode and open alternate roads or enable contraflow immediately.`
        });
      } else if (z.level === 3 && (z.evacuatedPct || 0) < 50 && z.etaMin <= 30) {
        issues.push({
          severity: 'crit',
          source: 'proactive',
          zoneName: z.name,
          text: `${z.name} is at LEVEL 3 GO with only ${z.evacuatedPct || 0}% evacuated and fire ETA ${z.etaMin} min. Consider contraflow on primary route.`
        });
      } else if (z.level === 2 && z.marginMin < 20 && z.marginMin >= 0) {
        issues.push({
          severity: 'warn',
          source: 'proactive',
          zoneName: z.name,
          text: `${z.name} safety margin is ${z.marginMin} min — recommend upgrade to LEVEL 3 GO within 5 min.`
        });
      } else if (z.bottleneck && z.bottleneck.ratio > 100) {
        issues.push({
          severity: 'warn',
          source: 'proactive',
          zoneName: z.name,
          text: `${z.name} primary route is over-capacity (${z.bottleneck.ratio}%). Suggest splitting flow to alternate.`
        });
      }
    }
    if (!issues.length) return null;
    return issues.sort((a, b) => (b.severity === 'crit') - (a.severity === 'crit'))[0];
  }

  _severity(text) {
    if (/WARN|critical|immediate|blocked|over[- ]?capacity/i.test(text)) return 'warn';
    if (/danger|EVACUATE|GO NOW/i.test(text)) return 'crit';
    return 'info';
  }

  _mockReply(prompt, ctx) {
    const s = this.state;
    const p = (prompt || '').toLowerCase();
    const zones = s.evacuation.zones;
    const goingZones = zones.filter(z => z.level === 3);
    const setZones = zones.filter(z => z.level === 2);

    if (/risk|biggest|priorit/.test(p)) {
      const worst = zones.slice().sort((a, b) => (a.marginMin - b.marginMin))[0];
      if (worst) {
        return {
          severity: worst.marginMin < 15 ? 'crit' : 'warn',
          source: 'mock-advisor',
          prompt,
          text: `Highest risk: ${worst.name} — fire ETA ${worst.etaMin} min, evacuation needs ${worst.evacMin} min, safety margin only ${worst.marginMin} min. ${worst.bottleneck ? `Bottleneck at edge ${worst.bottleneck.edgeId} (${worst.bottleneck.ratio}% cap).` : 'Routes are clear but margin is thin.'} Recommend ${worst.level < 3 ? 'upgrading to LEVEL 3 GO' : 'opening contraflow on primary route'} within 10 min.`
        };
      }
    }
    if (/wind|weather/.test(p)) {
      return {
        severity: s.weather.redFlag ? 'warn' : 'info',
        source: 'mock-advisor',
        prompt,
        text: `Wind ${Math.round(s.weather.windKph)} kph from ${Math.round(s.weather.windDeg)}°, gusts ${Math.round(s.weather.gustKph)} kph, RH ${Math.round(s.weather.humidity)}%. ${s.weather.redFlag ? 'RED FLAG conditions — fire spread will be aggressive.' : 'Conditions stable.'} Wind direction will push fire toward ${windTarget(s.weather.windDeg)}.`
      };
    }
    if (/lose|without|i-?15|sr-?67|highway/.test(p)) {
      return {
        severity: 'warn',
        source: 'mock-advisor',
        prompt,
        text: `If primary highway is lost: routing collapses to arterials, evacuation time increases by 35–60% and bottlenecks shift to surface streets. Recommend pre-positioning traffic units at the parallel arterial and considering contraflow on the secondary route.`
      };
    }
    if (/bottleneck/.test(p)) {
      const bn = s.evacuation.bottlenecks.slice(0, 3);
      if (bn.length === 0) return { severity: 'info', source: 'mock-advisor', prompt, text: 'No bottlenecks active. Routing flow is within capacity bounds.' };
      return {
        severity: 'warn',
        source: 'mock-advisor',
        prompt,
        text: `${bn.length} active bottlenecks. Worst: edge ${bn[0].edgeId} on ${bn[0].hwy} class road at ${Math.round(bn[0].ratio * 100)}% capacity. Contraflow on this segment would cut clearance time roughly in half.`
      };
    }
    if (/upgrade|level|go|set|ready/.test(p)) {
      const candidates = setZones.slice().sort((a, b) => a.marginMin - b.marginMin);
      if (!candidates.length) return { severity: 'info', source: 'mock-advisor', prompt, text: `No zones currently at LEVEL 2 SET. ${goingZones.length} at LEVEL 3 GO and being routed.` };
      return {
        severity: 'warn',
        source: 'mock-advisor',
        prompt,
        text: `Recommend upgrading ${candidates[0].name} to LEVEL 3 GO. Margin is ${candidates[0].marginMin} min and declining. Evacuation will need ${candidates[0].evacMin} min once triggered.`
      };
    }
    if (/how many|population|people|residents/.test(p)) {
      const total = s.evacuation.totalPopulation;
      const evacuated = Math.round(zones.reduce((a, z) => a + (z.evacuatedPct || 0) / 100 *
        s.scenario.populations.filter(pp => pp.zone === z.name).reduce((b, pp) => b + pp.count, 0), 0));
      return {
        severity: 'info',
        source: 'mock-advisor',
        prompt,
        text: `${total.toLocaleString()} residents in active zones. ${evacuated.toLocaleString()} evacuated so far (${Math.round(evacuated / total * 100)}%). Largest remaining: ${zones.slice().sort((a, b) => (b.evacuatedPct || 0) - (a.evacuatedPct || 0)).reverse()[0]?.name || '—'}.`
      };
    }
    // Generic
    return {
      severity: 'info',
      source: 'mock-advisor',
      prompt,
      text: `Snapshot: ${zones.length} zones, ${goingZones.length} at LEVEL 3 GO, ${setZones.length} at LEVEL 2 SET. Wind ${Math.round(s.weather.windKph)} kph from ${Math.round(s.weather.windDeg)}°. ${s.evacuation.bottlenecks.length} active bottlenecks. Top priority: review ${zones.slice().sort((a, b) => a.marginMin - b.marginMin)[0]?.name || 'fire perimeter'}.`
    };
  }
}

function windTarget(deg) {
  // Convert "from" direction to "toward" cardinal-ish
  const to = (deg + 180) % 360;
  if (to < 22.5 || to >= 337.5) return 'north';
  if (to < 67.5) return 'northeast';
  if (to < 112.5) return 'east';
  if (to < 157.5) return 'southeast';
  if (to < 202.5) return 'south';
  if (to < 247.5) return 'southwest';
  if (to < 292.5) return 'west';
  return 'northwest';
}
