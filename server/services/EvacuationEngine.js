// EvacuationEngine — capacity-aware Dijkstra with BPR congestion, fire-time
// overlay, multi-source assignment, and zone classification (Ready/Set/Go).
//
// Time model: every population node has a "demand" count. Each demand is
// routed to the nearest *reachable* shelter through a graph where blocked or
// fire-arriving edges are removed. After routing, edge flows are summed and
// BPR is applied to derive realistic clearance time.

const BPR_ALPHA = 0.15;
const BPR_BETA = 4.0;
const BPR_CAP = 6.0;             // cap the congestion multiplier so clearance stays reasonable
const VEH_PER_PERSON = 0.35;     // ~3 people per vehicle, evac assumption
const HEADWAY_MIN = 60;          // 1-hour evacuation window: vehicles per hour vs edge capacity per hour

export class EvacuationEngine {
  constructor(state) {
    this.state = state;
    this.lastResult = null;
  }

  // Build the routing graph from the current scenario, removing edges where
  // fire has already arrived (arrival time - current sim clock <= 0).
  buildGraph() {
    const { nodes, edges } = this.state.scenario;
    const adj = new Map();
    for (const n of nodes) adj.set(n.id, []);
    const fireArrival = this.state.fireArrivalByNode || new Map();
    const now = this.state.simTimeMin;
    for (const e of edges) {
      if (e.blocked) continue;
      const fa = Math.min(
        fireArrival.get(e.u) ?? Infinity,
        fireArrival.get(e.v) ?? Infinity
      );
      // fa is in absolute client-CA-clock minutes. Convert to relative: skip
      // edges where fire has already arrived at the current server sim clock.
      if (Number.isFinite(fa) && fa - now <= 0) continue;
      const length = this.edgeLength(e);
      const baseTimeMin = (length / 1000) / (e.speed / 60);
      const capacity = e.contra ? e.capacity * 1.8 : e.capacity;
      const edgeRec = {
        id: e.id, to: e.v, baseTimeMin, capacity,
        length, fa, hwy: e.hwy
      };
      adj.get(e.u).push({ ...edgeRec });
      adj.get(e.v).push({ ...edgeRec, to: e.u });
    }
    return adj;
  }

  edgeLength(e) {
    const A = this.state.scenario.nodes[e.u];
    const B = this.state.scenario.nodes[e.v];
    const dx = (B.x - A.x) * this.state.scenario.mPerCell;
    const dz = (B.z - A.z) * this.state.scenario.mPerCell;
    return Math.hypot(dx, dz);
  }

  // Single-source Dijkstra from a population node to the nearest shelter.
  // Returns { path: [edgeIds...], destNode, costMin } or null.
  shortestToShelter(adj, startNode, shelterIds, congestion) {
    const dist = new Map();
    const prev = new Map();      // node -> {from, edgeId}
    dist.set(startNode, 0);
    const pq = new MinHeap();
    pq.push(0, startNode);
    while (pq.size()) {
      const { val: u, key: d } = pq.pop();
      if (d > (dist.get(u) ?? Infinity)) continue;
      if (shelterIds.has(u)) {
        // Reconstruct
        const path = [];
        let cur = u;
        while (prev.has(cur)) {
          const { from, edgeId } = prev.get(cur);
          path.unshift(edgeId);
          cur = from;
        }
        return { destNode: u, costMin: d, path };
      }
      for (const e of (adj.get(u) || [])) {
        const eff = effectiveTime(e.baseTimeMin, congestion.get(e.id) || 0, e.capacity);
        const nd = d + eff;
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, { from: u, edgeId: e.id });
          pq.push(nd, e.to);
        }
      }
    }
    return null;
  }

  async runFullEvacuation() {
    const { populations, shelters, edges } = this.state.scenario;
    const adj = this.buildGraph();
    const shelterIds = new Set(shelters.map(s => s.nodeId));
    const congestion = new Map();    // edgeId -> assigned vehicles in headway window
    const edgeFlow = new Map();
    const shelterUsed = new Map(shelters.map(s => [s.nodeId, 0]));

    // Sort demand high-to-low so larger pops route first (fills capacity first).
    const demand = [...populations].sort((a, b) => b.count - a.count);

    const zoneRoutes = new Map();    // zoneName -> {primary: [edgeIds], pops, costMin}
    let routedPeople = 0;

    for (const p of demand) {
      // A single population may need to split across multiple shelters if the
      // nearest one fills up. Loop until all of p.count is placed (or no shelter
      // is reachable).
      let remaining = p.count;
      let safety = 6;     // at most 6 splits per population, prevents infinite loops
      while (remaining > 0 && safety-- > 0) {
        const availableShelters = new Set(
          [...shelterIds].filter(id => {
            const used = shelterUsed.get(id) || 0;
            const cap = shelters.find(s => s.nodeId === id).capacity;
            return used < cap;
          })
        );
        if (availableShelters.size === 0) break;

        const result = this.shortestToShelter(adj, p.nodeId, availableShelters, congestion);
        if (!result) break;

        const dest = shelters.find(s => s.nodeId === result.destNode);
        const slot = Math.max(0, dest.capacity - (shelterUsed.get(result.destNode) || 0));
        const placed = Math.min(remaining, slot);
        if (placed === 0) {
          // Mark this shelter as full and try again
          shelterUsed.set(result.destNode, dest.capacity);
          continue;
        }

        const vehicles = placed * VEH_PER_PERSON;
        for (const eid of result.path) {
          congestion.set(eid, (congestion.get(eid) || 0) + vehicles);
          edgeFlow.set(eid, (edgeFlow.get(eid) || 0) + vehicles);
        }
        shelterUsed.set(result.destNode, (shelterUsed.get(result.destNode) || 0) + placed);
        routedPeople += placed;
        remaining -= placed;

        const zoneRec = zoneRoutes.get(p.zone) || {
          edgeFreq: new Map(), totalCount: 0, costMin: 0, destinations: new Map()
        };
        for (const eid of result.path) {
          zoneRec.edgeFreq.set(eid, (zoneRec.edgeFreq.get(eid) || 0) + placed);
        }
        zoneRec.totalCount += placed;
        zoneRec.costMin = Math.max(zoneRec.costMin, result.costMin);
        zoneRec.destinations.set(dest.name,
          (zoneRec.destinations.get(dest.name) || 0) + placed);
        zoneRoutes.set(p.zone, zoneRec);
      }
    }

    // Identify bottlenecks: edges where flow/capacity > 0.55 (visualization-friendly)
    const bottlenecks = [];
    for (const [eid, flow] of edgeFlow) {
      const e = edges.find(x => x.id === eid);
      if (!e) continue;
      const ratio = flow / (e.capacity * (HEADWAY_MIN / 60));
      if (ratio > 0.55) {
        bottlenecks.push({ edgeId: eid, ratio: Math.min(ratio, 3), hwy: e.hwy });
      }
    }
    bottlenecks.sort((a, b) => b.ratio - a.ratio);

    // Update zones with computed evac time + level
    const zones = this.state.evacuation.zones.map(z => ({ ...z }));
    for (const z of zones) {
      // Earliest fire arrival to any zone population node
      let earliestFire = Infinity;
      for (const nid of z.populationNodeIds) {
        const a = this.state.fireArrivalByNode.get(nid);
        if (typeof a === 'number' && a < earliestFire) earliestFire = a;
      }
      // arrivalMin is an absolute client-CA-clock value that drifts from the
      // server clock (client CA steps ~2.5x faster). Convert to "time from
      // now" by subtracting the current server sim clock so zone ETAs read as
      // "fire arrives in N minutes" rather than "fire arrived at absolute
      // minute N."
      z.etaMin = Number.isFinite(earliestFire)
        ? Math.max(0, Math.round(earliestFire - this.state.simTimeMin))
        : 999;

      const route = zoneRoutes.get(z.name);
      if (route) {
        z.evacMin = Math.round(route.costMin + HEADWAY_MIN);
        z.marginMin = Number.isFinite(z.etaMin) ? z.etaMin - z.evacMin : 999;
        // Sort all route edges by frequency; top 18 = primary, next 10 = secondary.
        const sorted = [...route.edgeFreq.entries()].sort((a, b) => b[1] - a[1]);
        const primary   = sorted.slice(0, 18).map(([eid]) => eid);
        const secondary = sorted.slice(18, 28).map(([eid]) => eid);
        z.route = {
          edgeIds: primary,
          secondaryEdgeIds: secondary,
          destinations: [...route.destinations.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => ({ name, count }))
        };
        const myBottlenecks = bottlenecks.filter(b => primary.includes(b.edgeId));
        z.bottleneck = myBottlenecks.length
          ? { edgeId: myBottlenecks[0].edgeId, ratio: Math.round(myBottlenecks[0].ratio * 100) }
          : null;
      } else {
        z.evacMin = 0;
        z.route = null;
        z.bottleneck = null;
      }

      // Level classification
      if (z.override) {
        z.level = z.override;
      } else if (z.etaMin <= 60 || z.marginMin < 15) {
        z.level = 3;
      } else if (z.etaMin <= 120) {
        z.level = 2;
      } else {
        z.level = 1;
      }

      // Evacuation progress: linear ramp over evacMin simulated minutes.
      // Uses sim-clock delta so time-jump forward/back moves the percentage.
      const simElapsed = this.state.simTimeMin - this.state.evacuation.lastRunSimMin;
      if (z.level >= 3 && z.evacMin > 0) {
        z.evacuatedPct = Math.round(Math.min(100, (simElapsed / z.evacMin) * 100));
      }
    }

    const result = {
      zones,
      bottlenecks: bottlenecks.slice(0, 12),
      totalEvacuated: routedPeople,
      shelterUsage: shelters.map(s => ({
        nodeId: s.nodeId, name: s.name, capacity: s.capacity,
        used: shelterUsed.get(s.nodeId) || 0
      }))
    };
    this.lastResult = result;
    this.state.applyEvacuationResult(result);
    return result;
  }
}

function effectiveTime(baseTimeMin, flow, capacity) {
  if (capacity <= 0) return baseTimeMin * 5;
  const ratio = flow / (capacity * (HEADWAY_MIN / 60));
  const mult = Math.min(BPR_CAP, 1 + BPR_ALPHA * Math.pow(ratio, BPR_BETA));
  return baseTimeMin * mult;
}

// ---------- min heap ----------

class MinHeap {
  constructor() { this.h = []; }
  size() { return this.h.length; }
  push(key, val) {
    this.h.push({ key, val });
    this._up(this.h.length - 1);
  }
  pop() {
    if (!this.h.length) return null;
    const top = this.h[0];
    const last = this.h.pop();
    if (this.h.length) { this.h[0] = last; this._down(0); }
    return top;
  }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.h[p].key > this.h[i].key) {
        [this.h[p], this.h[i]] = [this.h[i], this.h[p]];
        i = p;
      } else break;
    }
  }
  _down(i) {
    const n = this.h.length;
    while (true) {
      const l = 2 * i + 1, r = 2 * i + 2;
      let s = i;
      if (l < n && this.h[l].key < this.h[s].key) s = l;
      if (r < n && this.h[r].key < this.h[s].key) s = r;
      if (s !== i) {
        [this.h[s], this.h[i]] = [this.h[i], this.h[s]];
        i = s;
      } else break;
    }
  }
}
