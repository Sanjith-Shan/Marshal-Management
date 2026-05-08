// End-to-end smoke: connect a Socket.IO client, exercise the full action
// pipeline (evacuate, mode, panel, block-road), and verify the server
// responds with snapshots that reflect each change.

import { io as ioClient } from 'socket.io-client';
import { spawn } from 'child_process';

const SERVER_URL = 'http://localhost:3001';

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('OK  :', msg);
  }
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async function main() {
  // Start server on alt port
  const env = { ...process.env, PORT: '3001', DISABLE_ARDUINO: '1' };
  const proc = spawn('node', ['server/index.js'], { env, stdio: 'inherit' });
  await wait(2000);

  let scenario = null, snapshot = null;
  const updates = { mode: [], panels: [], evac: [], advisor: [], edges: [] };

  const sock = ioClient(SERVER_URL, { transports: ['websocket'] });
  await new Promise((res, rej) => {
    sock.on('connect', res);
    setTimeout(() => rej(new Error('connect timeout')), 5000);
  });
  console.log('connected', sock.id);

  sock.on('scenario', (s) => { scenario = s; });
  sock.on('snapshot', (s) => { snapshot = s; });
  sock.on('mode', (m) => updates.mode.push(m));
  sock.on('panels', (p) => updates.panels.push(p));
  sock.on('evacuation', (e) => updates.evac.push(e));
  sock.on('advisor', (a) => updates.advisor.push(a));
  sock.on('edge:update', (e) => updates.edges.push(e));

  await wait(500);
  assert(scenario && scenario.nodes.length > 100, 'scenario received');
  assert(snapshot && snapshot.evacuation, 'snapshot received');

  // Toggle a panel
  sock.emit('action', { type: 'panel', payload: 'evacuation' });
  await wait(200);
  assert(updates.panels.some(p => p.evacuation === true), 'panel toggle reflected');

  // Switch mode
  sock.emit('action', { type: 'mode', payload: 'COMMAND' });
  await wait(200);
  assert(updates.mode.includes('COMMAND'), 'mode switch reflected');

  // Trigger evacuation
  sock.emit('action', { type: 'evacuate' });
  await wait(800);
  assert(updates.evac.length > 0, 'evacuation broadcast received');
  const ev = updates.evac[updates.evac.length - 1];
  assert(ev.zones && ev.zones.length === 3, 'evacuation has 3 zones');
  assert(ev.zones.every(z => 'route' in z), 'zones include route data');

  // Block a road
  const someEdgeId = scenario.edges[100].id;
  sock.emit('action', { type: 'block-road', payload: { edgeId: someEdgeId, blocked: true } });
  await wait(400);
  assert(updates.edges.some(e => e.id === someEdgeId && e.blocked), 'road blocked broadcast');

  // Ask AI
  sock.emit('ai:ask', "what's the biggest risk right now?");
  await wait(500);
  assert(updates.advisor.length > 0, 'advisor responded');
  console.log('  advisor said:', updates.advisor[updates.advisor.length - 1].text.slice(0, 120));

  // Time-jump forward (TODO group H1/H2). Verify sim clock advances and a
  // 'time-fast-forward' instruction is broadcast to the client.
  let fastForwardSeen = false;
  let lastTickMin = null;
  sock.on('time-fast-forward', () => { fastForwardSeen = true; });
  sock.on('tick', ({ simTimeMin }) => { lastTickMin = simTimeMin; });
  const beforeJumpTick = lastTickMin ?? 0;
  sock.emit('action', { type: 'time-jump', payload: { deltaMin: 30 } });
  await wait(400);
  assert(fastForwardSeen, 'time-fast-forward broadcast received');
  assert(lastTickMin >= beforeJumpTick + 25, `tick advanced by ~30 (was ${beforeJumpTick}, now ${lastTickMin})`);

  // Time-jump backward without enough history → expect a warning advisor msg,
  // not a crash.
  const advisorBefore = updates.advisor.length;
  sock.emit('action', { type: 'time-jump', payload: { deltaMin: -30 } });
  await wait(300);
  assert(updates.advisor.length > advisorBefore, 'rewind without history produces an advisor message');

  sock.disconnect();
  proc.kill();
  console.log('\ne2e test', process.exitCode ? 'FAILED' : 'PASSED');
  process.exit(process.exitCode || 0);
})();
