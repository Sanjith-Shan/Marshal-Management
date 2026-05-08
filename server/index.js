import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { StateManager } from './services/StateManager.js';
import { EvacuationEngine } from './services/EvacuationEngine.js';
import { WeatherService } from './services/WeatherService.js';
import { AIAdvisor } from './services/AIAdvisor.js';
import { ArduinoService } from './services/ArduinoService.js';
import { ScenarioBuilder, SCENARIOS, DEFAULT_SCENARIO_ID } from './services/ScenarioBuilder.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json());

// Serve built client if dist exists (production)
app.use(express.static(path.resolve(__dirname, '../dist')));

const httpServer = createServer(app);
const io = new SocketIO(httpServer, {
  cors: { origin: '*' }
});

// --------------------- bootstrap ---------------------

const scenario = ScenarioBuilder.build({ seed: 42 });
const state = new StateManager(scenario);
const evac = new EvacuationEngine(state);
const weather = new WeatherService();
const ai = new AIAdvisor(state, weather);
const arduino = new ArduinoService();

state.attachIO(io);

// --------------------- HTTP API ---------------------

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    arduino: arduino.connected,
    aiBackend: ai.backendName(),
    scenario: state.scenario.name,
    simTime: state.simTimeMin
  });
});

app.get('/api/scenario', (req, res) => {
  res.json(state.publicScenario());
});

app.get('/api/scenarios', (req, res) => {
  // List of available demo presets for the HUD picker.
  res.json({
    available: Object.values(SCENARIOS).map(s => ({ id: s.id, name: s.name })),
    current: state.scenario.scenarioId
  });
});

app.get('/api/snapshot', (req, res) => {
  res.json(state.snapshot());
});

app.post('/api/ai/ask', async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  const reply = await processAdvisorPrompt(prompt);
  res.json(reply);
});

// --------------------- WebSocket ---------------------

io.on('connection', (socket) => {
  console.log(`[ws] client connected ${socket.id}`);
  socket.emit('scenario', state.publicScenario());
  socket.emit('snapshot', state.snapshot());

  socket.on('disconnect', () => {
    console.log(`[ws] client disconnected ${socket.id}`);
  });

  // Client-driven actions (keyboard, mouse, hardware-mirrored)
  socket.on('action', async (msg) => {
    await handleAction(msg, socket);
  });

  socket.on('ai:ask', async (prompt) => {
    await processAdvisorPrompt(prompt);
  });

  // Fire CA runs on the client; it streams burning-cell counts back so the
  // server can keep the evacuation engine in sync.
  socket.on('fire:state', (data) => {
    state.updateFireFromClient(data);
  });

  // Client acknowledges a time-jump after fast-forwarding its CA. We update
  // arrival from the fresh data and re-run the evacuation engine so zones /
  // routes / bottlenecks reflect the post-jump fire state.
  socket.on('time-jump:applied', async (data) => {
    if (Array.isArray(data?.arrivalByNode)) {
      state.fireArrivalByNode = new Map(data.arrivalByNode);
    }
    if (data?.fire) {
      state.updateFireFromClient(data.fire);
    }
    try { await evac.runFullEvacuation(); } catch (e) { console.warn('evac after jump failed:', e.message); }
    if (state._pendingProactiveAfterJump) {
      state._pendingProactiveAfterJump = false;
      try {
        const insight = await ai.proactiveScan();
        if (insight) state.pushAdvisorMessage(insight);
      } catch (e) { console.warn('proactive after jump failed:', e.message); }
    }
  });
});

// --------------------- advisor prompt pipeline ---------------------

// Parses imperative intents out of the prompt, dispatches them through the
// same handleAction path the keyboard / hardware paths use, then asks the
// advisor — which now sees the post-mutation state in its context. The
// reply text is prefixed with what was applied so the panel + voice channel
// announce it.
async function processAdvisorPrompt(prompt) {
  const { actions, summary } = ai.parseIntents(prompt);
  for (const a of actions) {
    try { await handleAction(a); } catch (e) { console.warn('intent dispatch failed:', a.type, e.message); }
  }
  const reply = await ai.ask(prompt);
  if (summary) reply.text = `${summary} ${reply.text || ''}`.trim();
  state.pushAdvisorMessage(reply);
  return reply;
}

// --------------------- action dispatcher ---------------------

async function handleAction(msg, socket) {
  const { type, payload } = msg || {};
  switch (type) {
    case 'evacuate':
      state.setMode('EVACUATE');
      await evac.runFullEvacuation();
      break;
    case 'reset': {
      const nextId = payload?.scenarioId || state.scenario.scenarioId || DEFAULT_SCENARIO_ID;
      state.resetScenario(ScenarioBuilder.build({ seed: state.scenario.seed, scenarioId: nextId }));
      break;
    }
    case 'mode':
      state.setMode(payload);
      break;
    case 'panel':
      state.togglePanel(payload);
      break;
    case 'block-road':
      state.blockRoad(payload.edgeId, payload.blocked);
      await evac.runFullEvacuation();
      break;
    case 'designate-shelter':
      state.designateShelter(payload);
      await evac.runFullEvacuation();
      break;
    case 'override-zone':
      state.overrideZoneLevel(payload.zoneId, payload.level);
      break;
    case 'contraflow':
      state.setContraflow(payload.edgeId, payload.enabled);
      await evac.runFullEvacuation();
      break;
    case 'wind':
      state.setWind(payload);
      break;
    case 'timeline':
      state.setTimeline(payload.minutes);
      break;
    case 'time-jump': {
      const delta = Number(payload?.deltaMin) || 0;
      if (delta === 0) break;
      const absDelta = Math.abs(delta);
      const targetMin = Math.max(0, Math.min(600, state.simTimeMin + delta));

      if (delta > 0) {
        // Forward: bump server clock and instruct the client to fast-forward
        // its CA. Client will respond with `time-jump:applied` carrying a fresh
        // arrivalByNode, at which point we re-run the evacuation engine.
        const advanced = targetMin - state.simTimeMin;
        state.simTimeMin = targetMin;
        state.broadcast('tick', { simTimeMin: state.simTimeMin });
        const steps = Math.max(1, Math.round(advanced / 0.5));
        state.broadcast('time-fast-forward', { steps, targetMin });
        state.pushAdvisorMessage({
          severity: 'info', source: 'system',
          text: `Time +${Math.round(advanced)} min → T+${Math.round(targetMin)}m. Recomputing fire spread + evacuation…`
        });
        // Big jump → kick proactive scan after the client acks (evac will be
        // re-run in `time-jump:applied`). Otherwise the advisor lags up to a
        // wall-clock minute behind a sim that just leapt forward.
        if (absDelta >= 30) state._pendingProactiveAfterJump = true;
      } else {
        // Backward: restore from the nearest snapshot ≤ target. Server runs
        // evac with restored arrival; client restores its CA from its own ring.
        const snap = state.findSnapshotBefore(targetMin);
        if (!snap) {
          const earliest = state.snapshotRing[0]?.simTimeMin;
          state.pushAdvisorMessage({
            severity: 'warn', source: 'system',
            text: earliest != null
              ? `Cannot rewind to T+${Math.round(targetMin)}m. Earliest snapshot is T+${Math.round(earliest)}m.`
              : `Cannot rewind: no snapshots yet. Wait at least ${state.SNAPSHOT_INTERVAL_MIN} sim-minutes.`
          });
          break;
        }
        state.applyServerSnapshot(snap);
        state.broadcast('tick', { simTimeMin: state.simTimeMin });
        state.broadcast('time-rewind', { targetMin: snap.simTimeMin });
        try { await evac.runFullEvacuation(); } catch (e) { console.warn('evac after rewind failed:', e.message); }
        state.broadcast('snapshot', state.snapshot());
        state.pushAdvisorMessage({
          severity: 'info', source: 'system',
          text: `Rewound to T+${Math.round(snap.simTimeMin)}m. Fire and evacuation restored.`
        });
        if (absDelta >= 30) {
          try {
            const insight = await ai.proactiveScan();
            if (insight) state.pushAdvisorMessage(insight);
          } catch (e) { console.warn('proactive after rewind failed:', e.message); }
        }
      }
      break;
    }
    case 'joystick':
      // Broadcast directly to clients so DesktopControls can pulseRotate.
      // Server has no camera state; this is a pure client-side operation.
      state.broadcast('joystick', payload);
      break;
    case 'joystick:reset':
      state.broadcast('joystick:reset', {});
      break;
    case 'ptt':
      state.setPTT(payload.active);
      break;
    case 'ai:transcribe':
      // Alias for ai:ask sent from future voice-pipeline code. Prompt comes in
      // as payload.transcript; funnel through the same intent parser.
      if (payload?.transcript) await processAdvisorPrompt(payload.transcript);
      break;
    default:
      console.warn(`[action] unknown type "${type}"`);
  }
}

// Hardware board mirrors keyboard actions
arduino.on('event', (evt) => handleAction(evt));
arduino.start();

// --------------------- background loops ---------------------

// Sim clock — advances state.simTimeMin
setInterval(() => state.tickSimulation(), 1000);

// Weather refresh every 5 min
weather.start();
weather.on('update', (w) => state.updateWeather(w));

// Proactive AI: every 60 sec analyze the scene. Big sim-time jumps also kick
// this in the time-jump handler so the advisor doesn't lag a leaping clock.
setInterval(async () => {
  if (!state.aiProactiveEnabled) return;
  const insight = await ai.proactiveScan();
  if (insight) state.pushAdvisorMessage(insight);
}, 60_000);

// --------------------- start ---------------------

httpServer.listen(PORT, async () => {
  console.log(`\n  ▲  Marshal Management server`);
  console.log(`     http://localhost:${PORT}`);
  console.log(`     Vite dev:  http://localhost:5173`);
  console.log(`     AI backend: ${ai.backendName()}`);
  console.log(`     Arduino: ${arduino.connected ? 'connected' : 'keyboard fallback'}\n`);

  // Pre-compute an initial baseline evacuation so routes are visible before
  // the user presses E. Without fire-arrival data zones stay LEVEL 1 READY.
  try { await evac.runFullEvacuation(); } catch (e) { console.warn('initial evac failed:', e.message); }

  // Seed an opening advisor message so the panel isn't empty on first load.
  state.pushAdvisorMessage({
    severity: 'info',
    source: 'system',
    text: `${state.scenario.name}. ${state.evacuation.totalPopulation.toLocaleString()} residents in 3 zones. Wind ${Math.round(state.weather.windKph)} kph from ${Math.round(state.weather.windDeg)}°. Press E to trigger full evacuation, or hold Space to ask the advisor a question.`
  });
});
