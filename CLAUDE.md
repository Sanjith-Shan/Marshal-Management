# Marshal Management

AR fire-marshal command center for Reboot the Earth 2026 (UCSD). Runs on desktop browser + Meta Quest 3 (WebXR), with optional Arduino UNO command board.

## References

- @marshal-management-v3.md — original v3 spec (vision, full architecture, demo script). Authoritative for "what this should be."
- @BUILD_LOG.md — scope decisions, feature grading (🟢/🟡/🔴), known mocks, prioritized gaps, and **open questions for future sessions to interpret**. Authoritative for "what is actually built." Treat the grading as one developer's snapshot — re-grade rows as you observe behavior.

## Folder structure

```
client/                    Vite + Three.js + WebXR frontend
  src/
    main.js                App bootstrap; wires socket, scene, panels, controls
    ar/                    SceneRoot (renderer/scene/lights), ARSession (immersive-ar)
    terrain/               TerrainMesh — heightmap → displaced PlaneGeometry + procedural texture
    fire/                  CellularAutomata (Rothermel-lite) + FireOverlay (shader)
    evacuation/            Roads / Zones / Routes / Bottlenecks / Shelters / PopulationDots
    panels/                DOM glass-morphism panels (Weather, Evac, AI, Video) + base Panel
    interaction/           DesktopControls (mouse+WASD), Keybindings (hardware mirror), VoiceInput (Web Speech)
    ui/                    HUD (top bar, control strip, help) + styles.css
    utils/                 EventEmitter shim (browser-safe)
  index.html               Canvas + HUD shell
  vite.config.js           Dev proxy: /api + /socket.io → server:3000
server/                    Node + Express + Socket.IO backend
  index.js                 HTTP + WS bootstrap, action dispatcher, background loops
  services/
    ScenarioBuilder.js     Procedurally generates terrain, roads, populations, shelters (seedable)
    StateManager.js        Single source of truth; broadcasts deltas
    EvacuationEngine.js    Capacity-aware Dijkstra + BPR congestion + Ready/Set/Go classifier
    AIAdvisor.js           Gemini 2.5 Flash w/ full context; rules-based mock fallback
    WeatherService.js      NWS api.weather.gov polling (no key) + mock fallback
    ArduinoService.js      USB-serial reader (optional, soft-imported)
    rng.js                 Mulberry32 seedable PRNG
  _selftest.js             Hidden scenario + evac + AI smoke test
  _e2e.js                  Hidden socket round-trip test (boots server on :3001)
arduino/marshal_board/     Firmware for classic UNO + USB serial (reference path; see BUILD_LOG TODO group H — production target is UNO Q over wireless via Arduino App Lab)
data/demo-scenarios/       Reserved for saved demo states
```

## Dev commands

```bash
npm install                # serialport is optionalDependencies — failure is OK
npm run dev                # concurrently: server (:3000) + Vite (:5173). Open :5173.
npm run dev:server         # server only
npm run dev:client         # Vite only
npm run build              # production bundle → dist/
npm start                  # serve dist/ from the server

node server/_selftest.js   # scenario / evac / AI smoke (no network)
node server/_e2e.js        # full socket round-trip on :3001
```

Optional env (`.env`, see `.env.example`):
- `GEMINI_API_KEY` — switches AIAdvisor from mock to live Gemini 2.5 Flash
- `DISABLE_ARDUINO=1` — skip serial autodetect entirely
- `PORT` — server port (default 3000)

Arduino: the existing `arduino/marshal_board/marshal_board.ino` targets **classic UNO + Arduino IDE + USB serial** and is the working reference. The **production target is Arduino UNO Q** (wireless, battery-powered, Arduino App Lab) — see `BUILD_LOG.md` TODO group H for the planned migration. Don't delete the classic-UNO sketch; the new wireless path will mirror its action protocol.

## Conventions

- **Module style:** ES modules everywhere (`"type": "module"`). Use `import * as THREE from 'three'` on the client; Vite resolves it.
- **State flow:** client → `socket.emit('action', { type, payload })` → server `handleAction` dispatcher → `StateManager` mutator → `broadcast(...)`. Never mutate state from outside `StateManager`.
- **Snapshots vs deltas:** `snapshot` is a full state dump on connect/reset. After that, the server emits targeted events (`evacuation`, `weather`, `edge:update`, `advisor`, `mode`, `panels`, `tick`). Client renderers expose `applySnapshot(snap)` and individual setters; both code paths must produce the same visual result.
- **Renderers (client):** every visual layer is a class with a `.group` (THREE.Group) added to `SceneRoot.terrainGroup`, an `applySnapshot(snap)` method, and an optional `update(dt)` for per-frame animation. Follow this when adding new layers.
- **Grid coordinates:** scenario uses cell coords (`gx`, `gz` in `0..gridSize`). Convert to scene units with `terrain.gridToWorld(gx, gz, hOffset)`. Never bake world coords into scenario data.
- **Determinism:** scenario generation is seeded via `mulberry32(scenario.seed)`. Don't introduce `Math.random()` into `ScenarioBuilder.js` or downstream pre-compute paths — keeps demos reproducible.
- **Hardware ↔ keyboard ↔ HUD parity:** every Arduino event in `ArduinoService.js`, every key in `Keybindings.js`, and every relevant HUD button in `HUD.js` / `index.html` emit the same `{ type, payload }` shape. If you add a new control, wire all three paths. The `time-jump` action (added 2026-05-08 for TODO group H1) is the canonical three-way example.
- **Naming:** PascalCase classes/files for renderers and services; camelCase for fields/functions; sim time is always **minutes** (`simTimeMin`, `etaMin`, `evacMin`).
- **No new comments unless non-obvious.** Existing module headers explain why each file exists; one-line "what" comments are avoided.
- **Tests:** prefer extending `_selftest.js` (pure logic) or `_e2e.js` (socket flow) over adding a new framework. Both must end with `PASSED`.

## Build Log

After every significant feature or fix, append a dated entry to `BUILD_LOG.md` under a new `## YYYY-MM-DD` heading. State **what changed and why** in 1–3 lines. Reference file paths. This is the durable record of intent — commit messages cover the "what," BUILD_LOG covers the "why" and any scope/realism trade-offs.

## Git workflow — commit & push often

**Do not batch a whole session into one commit at the end.** Hackathon work moves fast and a single late push is how progress gets lost.

- After each completed task or distinct logical change, run `git add <specific files>` + `git commit` + `git push`.
- A good rhythm is one commit per task (per `TaskUpdate ... completed`) or roughly every 20–30 minutes of active editing — whichever comes first.
- Keep messages tight and scoped (`evac: cap BPR multiplier at 6×`, not `updates`). Reference files when useful.
- Push to `origin main` (or the active branch) after every commit, not at the end. The remote is the backup.
- Never use `git add -A` / `git add .` — stage only the files you actually changed. Never `--no-verify`. Never force-push without explicit user approval.
- If a commit pushes a partial / WIP state, say so in the message (`wip: …`) so future sessions know.
