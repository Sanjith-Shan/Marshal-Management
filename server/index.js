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
import { ScenarioBuilder } from './services/ScenarioBuilder.js';

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

app.get('/api/snapshot', (req, res) => {
  res.json(state.snapshot());
});

app.post('/api/ai/ask', async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  const reply = await ai.ask(prompt);
  state.pushAdvisorMessage(reply);
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
    const reply = await ai.ask(prompt);
    state.pushAdvisorMessage(reply);
  });

  // Fire CA runs on the client; it streams burning-cell counts back so the
  // server can keep the evacuation engine in sync.
  socket.on('fire:state', (data) => {
    state.updateFireFromClient(data);
  });
});

// --------------------- action dispatcher ---------------------

async function handleAction(msg, socket) {
  const { type, payload } = msg || {};
  switch (type) {
    case 'evacuate':
      state.setMode('EVACUATE');
      await evac.runFullEvacuation();
      break;
    case 'reset':
      state.resetScenario(ScenarioBuilder.build({ seed: state.scenario.seed }));
      break;
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
    case 'ptt':
      state.setPTT(payload.active);
      break;
    case 'ai:transcribe':
      const reply = await ai.ask(payload.transcript);
      state.pushAdvisorMessage(reply);
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

// Proactive AI: every 60 sec analyze the scene
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
