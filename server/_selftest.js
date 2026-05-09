// Hidden self-test: build a scenario, run a couple of evacuation passes
// (with and without simulated fire-arrival blocking), and verify outputs are
// plausible. Run with: `node server/_selftest.js`.

import { ScenarioBuilder } from './services/ScenarioBuilder.js';
import { StateManager } from './services/StateManager.js';
import { EvacuationEngine } from './services/EvacuationEngine.js';
import { AIAdvisor } from './services/AIAdvisor.js';

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('OK  :', msg);
  }
}

(async function main() {
  const scn = ScenarioBuilder.build({ seed: 42 });
  console.log('---');
  console.log('Scenario:', scn.name);
  console.log('  nodes:', scn.nodes.length, 'edges:', scn.edges.length);
  console.log('  populations (zones):', new Set(scn.populations.map(p => p.zone)).size,
              'total people:', scn.populations.reduce((a, p) => a + p.count, 0));
  console.log('  shelters:', scn.shelters.map(s => `${s.name}(${s.capacity})`).join(', '));
  console.log('  reachability:', scn.meta.reach);
  console.log('---');

  assert(scn.nodes.length > 100, 'scenario has at least 100 road nodes');
  assert(scn.edges.length > 200, 'scenario has at least 200 road edges');
  assert(scn.populations.length > 5, 'scenario has multiple population nodes');
  assert(scn.shelters.length >= 4, 'scenario has at least 4 shelters');
  assert(scn.meta.reach.ok, 'all populations can reach a shelter');

  const state = new StateManager(scn);
  const evac = new EvacuationEngine(state);

  // Initial run with no fire
  let result = await evac.runFullEvacuation();
  console.log('Initial evac:');
  for (const z of result.zones) {
    console.log(`  ${z.name}: L${z.level} eta=${z.etaMin}m evac=${z.evacMin}m margin=${z.marginMin}m route?${!!z.route}`);
  }
  assert(result.zones.length === 8, '8 zones returned');
  assert(result.zones.every(z => z.evacMin >= 0), 'all zones have non-negative evac time');
  assert(result.shelterUsage.some(s => s.used > 0), 'at least one shelter is in use');

  // Simulate fire arriving at a key node — pick a node near a population centroid.
  const popNode = scn.populations[0].nodeId;
  state.fireArrivalByNode = new Map([[popNode, 30]]);
  result = await evac.runFullEvacuation();
  console.log('After fire-arrival injection:');
  for (const z of result.zones) {
    console.log(`  ${z.name}: L${z.level} eta=${z.etaMin}m evac=${z.evacMin}m`);
  }
  assert(result.zones[0].etaMin <= 30, 'fire arrival reflected in zone ETA');

  // Block a highway and re-run
  const hwy = scn.edges[scn.highways[Math.floor(scn.highways.length / 2)]];
  state.blockRoad(hwy.id, true);
  result = await evac.runFullEvacuation();
  console.log('After blocking a highway segment:');
  console.log(`  bottlenecks: ${result.bottlenecks.length}`);
  console.log(`  total evacuated: ${result.totalEvacuated}`);
  assert(result.totalEvacuated > 0, 'still evacuating after blockage');

  // ---- Snapshot ring buffer (TODO group H3) ----
  // Push a couple of snapshots at distinct sim times, verify findSnapshotBefore
  // returns the correct one, and that applyServerSnapshot restores state.
  state.simTimeMin = 10;
  state.fireArrivalByNode = new Map([[scn.populations[0].nodeId, 25]]);
  state.pushServerSnapshot();
  state.simTimeMin = 25;
  state.fireArrivalByNode = new Map([[scn.populations[0].nodeId, 12]]);
  state.pushServerSnapshot();
  assert(state.snapshotRing.length === 2, 'two snapshots accumulated');
  const before20 = state.findSnapshotBefore(20);
  assert(before20 && before20.simTimeMin === 10, 'findSnapshotBefore picks the latest snap ≤ target');
  const before50 = state.findSnapshotBefore(50);
  assert(before50 && before50.simTimeMin === 25, 'findSnapshotBefore picks the most recent for high targets');
  const beforeZero = state.findSnapshotBefore(0);
  assert(beforeZero === null, 'findSnapshotBefore returns null when no snap ≤ target');

  // Mutate state, then rewind.
  state.simTimeMin = 99;
  state.blockRoad(scn.edges[0].id, true);
  const restoreOk = state.applyServerSnapshot(before20);
  assert(restoreOk, 'applyServerSnapshot returns true');
  assert(state.simTimeMin === 10, 'sim time restored to snapshot');
  assert(scn.edges[0].blocked === false, 'edge blocked flag rolled back by snapshot');
  assert(state.fireArrivalByNode.get(scn.populations[0].nodeId) === 25, 'fire arrival restored');

  // Ring eviction
  for (let i = 0; i < 30; i++) {
    state.simTimeMin = 100 + i;
    state.pushServerSnapshot();
  }
  assert(state.snapshotRing.length === state.SNAPSHOT_RING_MAX, 'ring buffer caps at SNAPSHOT_RING_MAX');

  // AI advisor smoke test (mock, no API key)
  const ai = new AIAdvisor(state, { current: {} });
  console.log('AI backend:', ai.backendName());
  const r = await ai.ask("what's my biggest risk right now?");
  console.log('AI reply:', r.text.slice(0, 200));
  assert(r.text.length > 20, 'AI returned a non-trivial reply');

  // ---- AI intent parsing (Critical gap #4) ----
  const intentPoway = ai.parseIntents('Upgrade Poway to GO');
  assert(intentPoway.actions.some(a => a.type === 'override-zone' && a.payload.level === 3),
    'parseIntents: "Upgrade Poway to GO" → override-zone level 3');
  const intentZoneA = ai.parseIntents('trigger evacuation for Zone A');
  assert(intentZoneA.actions.some(a => a.type === 'override-zone' && a.payload.level === 3),
    'parseIntents: "trigger evacuation for Zone A" → Zone A=Scripps Ranch override level 3');
  const intentBlock = ai.parseIntents('Block SR-67');
  assert(intentBlock.actions.length > 0 && intentBlock.actions.every(a => a.type === 'block-road' && a.payload.blocked === true),
    'parseIntents: "Block SR-67" → block-road for trunk segments');
  const intentContra = ai.parseIntents('Enable contraflow on I-15');
  assert(intentContra.actions.length > 0 && intentContra.actions.every(a => a.type === 'contraflow' && a.payload.enabled === true),
    'parseIntents: "Enable contraflow on I-15" → contraflow for motorway segments');
  const intentDowngrade = ai.parseIntents('downgrade Ramona to ready');
  assert(intentDowngrade.actions.some(a => a.type === 'override-zone' && a.payload.level === 1),
    'parseIntents: "downgrade Ramona to ready" → level 1');
  const intentNoise = ai.parseIntents('how ready is Poway?');
  assert(intentNoise.actions.length === 0,
    'parseIntents: casual "how ready is Poway?" emits no action');
  const intentBlank = ai.parseIntents("what's the weather like?");
  assert(intentBlank.actions.length === 0,
    'parseIntents: question with no command verb emits no action');

  console.log('---');
  console.log('Self-test', process.exitCode ? 'FAILED' : 'PASSED');
})();
