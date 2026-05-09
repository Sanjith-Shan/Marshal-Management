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

    // Wind penalty: nudge the router away from roads aligned with the fire
    // spread direction. Uses the same convention as CellularAutomata:
    // windDeg is FROM direction; fire spreads TOWARD (windDeg+180).
    const weather = this.state.weather;
    const towardRad = ((weather.windDeg + 180) % 360) * Math.PI / 180;
    const windX = Math.sin(towardRad);
    const windZ = -Math.cos(towardRad);    // matches CA wy convention
    const useWindPenalty = weather.windKph > 20;

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
      const baseTime = (length / 1000) / (e.speed / 60);
      const capacity = e.contra ? e.capacity * 1.8 : e.capacity;

      // Per-direction wind penalty: going downwind (+align) costs up to 25%
      // more time so Dijkstra naturally prefers crosswind/upwind routes.
      let penaltyUV = 1, penaltyVU = 1;
      if (useWindPenalty) {
        const A = nodes[e.u], B = nodes[e.v];
        const dx = B.x - A.x, dz = B.z - A.z;
        const len = Math.hypot(dx, dz) || 1;
        const alignUV = (dx * windX + dz * windZ) / len;
        penaltyUV = 1 + 0.25 * Math.max(0,  alignUV);
        penaltyVU = 1 + 0.25 * Math.max(0, -alignUV);
      }

      adj.get(e.u).push({ id: e.id, to: e.v, baseTimeMin: baseTime * penaltyUV, capacity, length, fa, hwy: e.hwy });
      adj.get(e.v).push({ id: e.id, to: e.u, baseTimeMin: baseTime * penaltyVU, capacity, length, fa, hwy: e.hwy });
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
    const congestion = new Map();    // edgeId -> assigned vehicles in headway window
    const edgeFlow = new Map();
    const shelterUsed = new Map(shelters.map(s => [s.nodeId, 0]));

    // Group populations by zone so each zone fills its CLOSEST shelter first
    // before overflowing — avoids the multi-zone scramble that lets a single
    // mega-shelter (Qualcomm) absorb everyone.
    const popsByZone = new Map();
    for (const p of populations) {
      if (!popsByZone.has(p.zone)) popsByZone.set(p.zone, []);
      popsByZone.get(p.zone).push(p);
    }

    // Process zones by closest-shelter affinity (cheapest-cost-to-any-shelter
    // first). Zones with the strongest local match secure their preferred
    // shelter before farther zones bid on it. Falls back to total-population
    // tiebreak if costs are equal (shouldn't happen on real graphs).
    const allShelterIds = new Set(shelters.filter(s => !s.compromised).map(s => s.nodeId));
    const zoneOrder = [...popsByZone.entries()]
      .map(([name, pops]) => {
        const sortedPops = pops.slice().sort((a, b) => b.count - a.count);
        const repNode = sortedPops[0].nodeId;
        const r = this.shortestToShelter(adj, repNode, allShelterIds, congestion);
        return {
          name,
          pops,
          total: pops.reduce((a, p) => a + p.count, 0),
          closestCost: r ? r.costMin : Infinity,
        };
      })
      .sort((a, b) => a.closestCost - b.closestCost || b.total - a.total);

    const zoneRoutes = new Map();    // zoneName -> {paths, totalCount, costMin, destinations}
    let routedPeople = 0;

    for (const zone of zoneOrder) {
      // Sort this zone's populations biggest first (largest blocks of people
      // claim closest-shelter slots before tail nodes scrape up overflow).
      const zonePops = zone.pops.slice().sort((a, b) => b.count - a.count);
      // Use the zone's biggest population node as the representative for
      // shelter ranking — they're geographically clustered, so all zone pops
      // share the same shelter preference order.
      const repNode = zonePops[0].nodeId;

      for (const p of zonePops) {
        let remaining = p.count;
        let safety = 6;
        while (remaining > 0 && safety-- > 0) {
          // Re-rank shelters every iteration: a shelter that filled mid-loop
          // gets dropped; the next-closest non-full non-compromised wins.
          const availableShelters = new Set(
            shelters
              .filter(s => !s.compromised)
              .filter(s => (shelterUsed.get(s.nodeId) || 0) < s.capacity)
              .map(s => s.nodeId)
          );
          if (availableShelters.size === 0) break;

          // Multi-target Dijkstra from THIS zone's representative node
          // determines the closest available shelter for the whole zone.
          // Then we route this specific population to that same shelter so
          // every member of the zone visually lands on the same destination.
          const repResult = this.shortestToShelter(adj, repNode, availableShelters, congestion);
          if (!repResult) break;
          const targetShelter = repResult.destNode;

          // Now compute the actual path from THIS population node to that
          // chosen shelter (different pop nodes in the zone take slightly
          // different paths to converge on the same destination).
          const result = this.shortestToShelter(adj, p.nodeId, new Set([targetShelter]), congestion);
          if (!result) {
            // Pop isolated from chosen shelter — try the next-best by
            // marking this one full for THIS pop only.
            shelterUsed.set(targetShelter, shelters.find(s => s.nodeId === targetShelter).capacity);
            continue;
          }

          const dest = shelters.find(s => s.nodeId === result.destNode);
          const slot = Math.max(0, dest.capacity - (shelterUsed.get(result.destNode) || 0));
          const placed = Math.min(remaining, slot);
          if (placed === 0) {
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
            paths: [], totalCount: 0, costMin: 0, destinations: new Map()
          };
          zoneRec.paths.push({
            path: result.path,
            count: placed,
            dest: dest.name,
            destNode: result.destNode,
            startNodeId: p.nodeId,
            costMin: result.costMin,
          });
          zoneRec.totalCount += placed;
          zoneRec.costMin = Math.max(zoneRec.costMin, result.costMin);
          zoneRec.destinations.set(dest.name,
            (zoneRec.destinations.get(dest.name) || 0) + placed);
          zoneRoutes.set(p.zone, zoneRec);
        }
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
      if (route && route.paths.length) {
        z.evacMin = Math.round(route.costMin + HEADWAY_MIN);
        z.marginMin = Number.isFinite(z.etaMin) ? z.etaMin - z.evacMin : 999;
        // Group paths by destination shelter. Primary route goes to the
        // shelter receiving the MOST evacuees from this zone (the "main"
        // destination). Pick the longest path to that destination so the
        // visual spans from population to shelter — gives a complete,
        // connected polyline (no frequency-aggregation gaps).
        const pathsByDest = new Map();
        for (const p of route.paths) {
          if (!pathsByDest.has(p.dest)) pathsByDest.set(p.dest, []);
          pathsByDest.get(p.dest).push(p);
        }
        let topDest = null, topCount = -1;
        for (const [dest, paths] of pathsByDest) {
          const c = paths.reduce((a, p) => a + p.count, 0);
          if (c > topCount) { topCount = c; topDest = dest; }
        }
        const topPaths = pathsByDest.get(topDest)
          .slice().sort((a, b) => b.path.length - a.path.length);
        const primary = topPaths[0].path.slice();
        const primarySet = new Set(primary);

        // Secondary: paths to alternate shelters + secondary subgroups going
        // to the primary destination, edges not already on primary.
        const seen = new Set(primarySet);
        const secondaryEdges = [];
        // Prefer alt-destination paths first (they show alternate routes).
        const altPaths = [];
        for (const [dest, paths] of pathsByDest) {
          if (dest === topDest) continue;
          // Longest path per alt destination
          paths.slice().sort((a, b) => b.path.length - a.path.length);
          altPaths.push(...paths);
        }
        // Then leftover paths to top destination.
        for (let i = 1; i < topPaths.length; i++) altPaths.push(topPaths[i]);
        for (const p of altPaths) {
          for (const eid of p.path) {
            if (seen.has(eid)) continue;
            seen.add(eid);
            secondaryEdges.push(eid);
            if (secondaryEdges.length >= 80) break;
          }
          if (secondaryEdges.length >= 80) break;
        }
        z.route = {
          edgeIds: primary,
          startNodeId: topPaths[0].startNodeId,
          endNodeId: topPaths[0].destNode,
          secondaryEdgeIds: secondaryEdges,
          destinations: [...route.destinations.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => ({ name, count }))
        };
        const myBottlenecks = bottlenecks.filter(b => primarySet.has(b.edgeId));
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
