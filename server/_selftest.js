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
  assert(scn.shelters.length === 3, 'scenario has 3 shelters');
  assert(scn.meta.reach.ok, 'all populations can reach a shelter');

  const state = new StateManager(scn);
  const evac = new EvacuationEngine(state);

  // Initial run with no fire
  let result = await evac.runFullEvacuation();
  console.log('Initial evac:');
  for (const z of result.zones) {
    console.log(`  ${z.name}: L${z.level} eta=${z.etaMin}m evac=${z.evacMin}m margin=${z.marginMin}m route?${!!z.route}`);
  }
  assert(result.zones.length === 3, '3 zones returned');
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

  // AI advisor smoke test (mock, no API key)
  const ai = new AIAdvisor(state, { current: {} });
  console.log('AI backend:', ai.backendName());
  const r = await ai.ask("what's my biggest risk right now?");
  console.log('AI reply:', r.text.slice(0, 200));
  assert(r.text.length > 20, 'AI returned a non-trivial reply');

  console.log('---');
  console.log('Self-test', process.exitCode ? 'FAILED' : 'PASSED');
})();
