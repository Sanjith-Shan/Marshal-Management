// Single source of truth for the running session. Wraps the scenario, current
// fire state (driven by the client CA), evacuation results, panel visibility,
// and the advisor message log. All mutations broadcast a partial snapshot to
// connected sockets.

import { EventEmitter } from 'events';

export class StateManager extends EventEmitter {
  constructor(scenario) {
    super();
    this.io = null;
    this.scenario = scenario;
    this.simTimeMin = 0;
    this.simRunning = true;
    this.mode = 'MONITOR';                    // MONITOR | COMMAND | EVACUATE
    this.panels = {
      weather: false,
      evacuation: false,
      advisor: true,
      video: false
    };
    this.weather = {
      windDeg: 220,                           // wind FROM direction (degrees)
      windKph: 35,
      gustKph: 55,
      tempC: 32,
      humidity: 14,
      redFlag: true,
      station: 'KSAN'
    };
    this.fire = {
      burningCells: 1,
      perimeterCells: 4,
      burnedCells: 0,
      arrivalGrid: null              // optional Float32Array: cell -> minute
    };
    this.fireArrivalByNode = new Map();   // nodeId -> minutes until fire
    this.evacuation = {
      lastRunAt: 0,
      lastRunSimMin: 0,      // sim-clock when evac last ran (for evacuatedPct)
      zones: scenario.zones.map(z => ({ ...z })),
      bottlenecks: [],
      shelterUsage: scenario.shelters.map(s => ({ nodeId: s.nodeId, name: s.name, capacity: s.capacity, used: 0 })),
      lostRoads: 0,
      totalEvacuated: 0,
      totalPopulation: scenario.populations.reduce((a, p) => a + p.count, 0)
    };
    this.advisorMessages = [];
    this.aiProactiveEnabled = true;
    this.ptt = false;
    this.timelineMin = 0;
    this.firms = { available: false, count: 0, hotspots: [] };

    // Snapshot ring for time-jump rewind (TODO group H3). Pushed every
    // SNAPSHOT_INTERVAL_MIN simulated minutes via tickSimulation; bounded to
    // SNAPSHOT_RING_MAX entries (~2 hr of demo history at default cadence).
    this.snapshotRing = [];
    this.SNAPSHOT_INTERVAL_MIN = 5;
    this.SNAPSHOT_RING_MAX = 24;
    this._lastSnapshotMin = -Infinity;
  }

  attachIO(io) {
    this.io = io;
  }

  broadcast(event, payload) {
    if (this.io) this.io.emit(event, payload);
  }

  // ----- snapshot -----

  publicScenario() {
    // Strip ArrayBuffers from heightmap/fuel for socket-friendliness; client
    // fetches them via REST or just regenerates client-side using the same seed.
    return {
      seed: this.scenario.seed,
      scenarioId: this.scenario.scenarioId,
      scenarioName: this.scenario.scenarioName,
      scenarioMeta: this.scenario.scenarioMeta,
      name: this.scenario.name,
      gridSize: this.scenario.gridSize,
      worldMeters: this.scenario.worldMeters,
      mPerCell: this.scenario.mPerCell,
      heightmap: Array.from(this.scenario.heightmap),
      fuelGrid: Array.from(this.scenario.fuelGrid),
      nodes: this.scenario.nodes,
      edges: this.scenario.edges,
      highways: this.scenario.highways,
      populations: this.scenario.populations,
      shelters: this.scenario.shelters,
      ignition: this.scenario.ignition
    };
  }

  snapshot() {
    return {
      simTimeMin: this.simTimeMin,
      simRunning: this.simRunning,
      mode: this.mode,
      panels: { ...this.panels },
      weather: { ...this.weather },
      fire: { ...this.fire, arrivalGrid: undefined },
      evacuation: {
        lastRunAt: this.evacuation.lastRunAt,
        zones: this.evacuation.zones.map(z => ({ ...z })),
        bottlenecks: this.evacuation.bottlenecks.slice(0, 10),
        shelterUsage: this.evacuation.shelterUsage,
        lostRoads: this.evacuation.lostRoads,
        totalEvacuated: this.evacuation.totalEvacuated,
        totalPopulation: this.evacuation.totalPopulation
      },
      advisorMessages: this.advisorMessages.slice(-20),
      ptt: this.ptt,
      timelineMin: this.timelineMin,
      firms: this.firms,
      edgeBlockedIds: this.scenario.edges.filter(e => e.blocked).map(e => e.id),
      edgeContraflowIds: this.scenario.edges.filter(e => e.contra).map(e => e.id)
    };
  }

  // ----- mutators -----

  tickSimulation() {
    if (!this.simRunning) return;
    // Demo time: 2 wall-seconds = 1 simulated minute. A 60-min event plays
    // in 2 real minutes; clean integer-minute increments suit HH:MM display.
    this.simTimeMin += 1;
    if (this.simTimeMin > 600) this.simRunning = false;
    this.maybePushSnapshot();
    this.broadcast('tick', { simTimeMin: this.simTimeMin });
  }

  // ----- snapshot ring (time-jump rewind) -----

  maybePushSnapshot() {
    if (this.simTimeMin - this._lastSnapshotMin < this.SNAPSHOT_INTERVAL_MIN) return;
    this._lastSnapshotMin = this.simTimeMin;
    this.pushServerSnapshot();
  }

  pushServerSnapshot() {
    const snap = {
      simTimeMin: this.simTimeMin,
      weather: { ...this.weather },
      fire: { ...this.fire, arrivalGrid: undefined },
      fireArrivalByNode: Array.from(this.fireArrivalByNode.entries()),
      evacuation: {
        lastRunAt: this.evacuation.lastRunAt,
        zones: this.evacuation.zones.map(z => ({
          ...z,
          route: z.route ? { ...z.route, edgeIds: z.route.edgeIds?.slice() || [], destinations: (z.route.destinations || []).map(d => ({ ...d })) } : null,
          bottleneck: z.bottleneck ? { ...z.bottleneck } : null
        })),
        bottlenecks: this.evacuation.bottlenecks.map(b => ({ ...b })),
        shelterUsage: this.evacuation.shelterUsage.map(s => ({ ...s })),
        lostRoads: this.evacuation.lostRoads,
        totalEvacuated: this.evacuation.totalEvacuated,
        totalPopulation: this.evacuation.totalPopulation
      },
      edgeBlockedIds: this.scenario.edges.filter(e => e.blocked).map(e => e.id),
      edgeContraflowIds: this.scenario.edges.filter(e => e.contra).map(e => e.id)
    };
    this.snapshotRing.push(snap);
    while (this.snapshotRing.length > this.SNAPSHOT_RING_MAX) this.snapshotRing.shift();
  }

  findSnapshotBefore(targetMin) {
    let best = null;
    for (const s of this.snapshotRing) {
      if (s.simTimeMin <= targetMin && (!best || s.simTimeMin > best.simTimeMin)) best = s;
    }
    return best;
  }

  applyServerSnapshot(snap) {
    if (!snap) return false;
    this.simTimeMin = snap.simTimeMin;
    this.weather = { ...snap.weather };
    this.fire = { ...snap.fire, arrivalGrid: null };
    this.fireArrivalByNode = new Map(snap.fireArrivalByNode);
    this.evacuation = {
      lastRunAt: snap.evacuation.lastRunAt,
      zones: snap.evacuation.zones.map(z => ({
        ...z,
        route: z.route ? { ...z.route, edgeIds: z.route.edgeIds.slice(), destinations: (z.route.destinations || []).map(d => ({ ...d })) } : null,
        bottleneck: z.bottleneck ? { ...z.bottleneck } : null
      })),
      bottlenecks: snap.evacuation.bottlenecks.map(b => ({ ...b })),
      shelterUsage: snap.evacuation.shelterUsage.map(s => ({ ...s })),
      lostRoads: snap.evacuation.lostRoads,
      totalEvacuated: snap.evacuation.totalEvacuated,
      totalPopulation: snap.evacuation.totalPopulation
    };
    // Restore edge flags from the snapshot
    const blockedSet = new Set(snap.edgeBlockedIds);
    const contraSet = new Set(snap.edgeContraflowIds);
    for (const e of this.scenario.edges) {
      e.blocked = blockedSet.has(e.id);
      e.contra = contraSet.has(e.id);
    }
    this._lastSnapshotMin = snap.simTimeMin;
    return true;
  }

  resetScenario(scenario) {
    this.scenario = scenario;
    this.simTimeMin = 0;
    this.simRunning = true;
    this.fire = { burningCells: 1, perimeterCells: 4, burnedCells: 0, arrivalGrid: null };
    this.fireArrivalByNode.clear();
    this.evacuation = {
      lastRunAt: 0,
      lastRunSimMin: 0,
      zones: scenario.zones.map(z => ({ ...z })),
      bottlenecks: [],
      shelterUsage: scenario.shelters.map(s => ({ nodeId: s.nodeId, name: s.name, capacity: s.capacity, used: 0 })),
      lostRoads: 0,
      totalEvacuated: 0,
      totalPopulation: scenario.populations.reduce((a, p) => a + p.count, 0)
    };
    this.snapshotRing = [];
    this._lastSnapshotMin = -Infinity;
    this.advisorMessages = [];
    this.broadcast('scenario', this.publicScenario());
    this.broadcast('snapshot', this.snapshot());
    this.pushAdvisorMessage({
      severity: 'info',
      source: 'system',
      text: 'Scenario reset. Fire ignition seeded. All zones reset to LEVEL 1 READY.'
    });
  }

  setMode(mode) {
    if (!['MONITOR', 'COMMAND', 'EVACUATE'].includes(mode)) return;
    this.mode = mode;
    this.broadcast('mode', mode);
    this.broadcast('snapshot', this.snapshot());
  }

  toggleSim(running) {
    this.simRunning = running == null ? !this.simRunning : !!running;
    this.broadcast('sim', { running: this.simRunning });
  }

  togglePanel(name) {
    if (!(name in this.panels)) return;
    this.panels[name] = !this.panels[name];
    this.broadcast('panels', { ...this.panels });
  }

  blockRoad(edgeId, blocked = true) {
    const e = this.scenario.edges.find(e => e.id === edgeId);
    if (!e) return;
    e.blocked = !!blocked;
    this.evacuation.lostRoads = this.scenario.edges.filter(e => e.blocked).length;
    this.broadcast('edge:update', { id: e.id, blocked: e.blocked, contra: e.contra });
  }

  setContraflow(edgeId, enabled) {
    const e = this.scenario.edges.find(e => e.id === edgeId);
    if (!e) return;
    e.contra = !!enabled;
    this.broadcast('edge:update', { id: e.id, blocked: e.blocked, contra: e.contra });
  }

  designateShelter({ nodeId, name, capacity }) {
    if (this.scenario.shelters.find(s => s.nodeId === nodeId)) return;
    this.scenario.shelters.push({ nodeId, name, capacity, used: 0 });
    this.broadcast('shelters', this.scenario.shelters);
  }

  overrideZoneLevel(zoneId, level) {
    const z = this.evacuation.zones.find(z => z.id === zoneId);
    if (!z) return;
    z.override = level;
    z.level = level;
    this.broadcast('snapshot', this.snapshot());
  }

  setWind({ deg, kph }) {
    if (typeof deg === 'number') this.weather.windDeg = deg;
    if (typeof kph === 'number') this.weather.windKph = kph;
    this.broadcast('weather', this.weather);
  }

  setTimeline(min) {
    this.timelineMin = Math.max(0, Math.min(180, min));
    this.broadcast('timeline', this.timelineMin);
  }

  setPTT(active) {
    this.ptt = !!active;
    this.broadcast('ptt', this.ptt);
  }

  updateWeather(w) {
    Object.assign(this.weather, w);
    this.broadcast('weather', this.weather);
  }

  updateFireFromClient(data) {
    // data: { burningCells, perimeterCells, burnedCells, arrivalByNode: [[nodeId,min]...] }
    if (typeof data.burningCells === 'number') this.fire.burningCells = data.burningCells;
    if (typeof data.perimeterCells === 'number') this.fire.perimeterCells = data.perimeterCells;
    if (typeof data.burnedCells === 'number') this.fire.burnedCells = data.burnedCells;
    if (Array.isArray(data.arrivalByNode)) {
      this.fireArrivalByNode = new Map(data.arrivalByNode);
    }
    this.broadcast('fire', { ...this.fire });
  }

  applyEvacuationResult(result) {
    this.evacuation.lastRunAt = Date.now();
    this.evacuation.lastRunSimMin = this.simTimeMin;
    this.evacuation.zones = result.zones;
    this.evacuation.bottlenecks = result.bottlenecks;
    this.evacuation.shelterUsage = result.shelterUsage || this.evacuation.shelterUsage;
    this.evacuation.totalEvacuated = result.totalEvacuated;
    this.broadcast('evacuation', this.snapshot().evacuation);
  }

  pushAdvisorMessage(msg) {
    if (!msg) return;
    const entry = { ts: Date.now(), ...msg };
    this.advisorMessages.push(entry);
    if (this.advisorMessages.length > 200) this.advisorMessages.shift();
    this.broadcast('advisor', entry);
  }
}
