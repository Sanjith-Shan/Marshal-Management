# Marshal Management — Build Log

**Hackathon:** Reboot the Earth 2026 | UCSD | May 8–9, 2026
**Status:** In Progress

## 2026-05-08 — session 5

**Demo scenario library + picker, contraflow animation, AI terrain overlays.** Three commits, gates green throughout.

**1. Demo scenarios (commit `4faee34`):**
   - `ScenarioBuilder` exports `SCENARIOS` dict with three named presets sharing seed 42 (same Cedar Corridor map) but distinct ignition points: Cedar Fire (NE, default), Witch Creek (far east), Plumas Approach (west). `build({ scenarioId })` overrides the picked ignition.
   - `GET /api/scenarios` returns the available list + currently-loaded id.
   - Reset action accepts `payload.scenarioId`.
   - `<select id="scenario-picker">` in the HUD bottom strip; `_wireScenarioPicker` fetches the list on boot, syncs on `scenario` socket event, emits `reset` action with new id on change.
   - Closes BUILD_LOG #21 (reset only re-seeded same scenario; no scenario picker).

**2. Contraflow animation (commit `1b535d5`):**
   - New `client/src/evacuation/ContraflowAnimator.js`. Owns one `Points` cloud per contraflowing edge: 6 cyan particles riding a phase from u→v at 0.45 units/s. Communicates direction of mandatory outbound flow.
   - `applySnapshot(snap)` adds/removes per-edge entries based on `snap.edgeContraflowIds`.
   - `setEvacMode(active)` boosts particle size + opacity in EVACUATE.
   - Closes BUILD_LOG #9 (contraflow had no animated visual, color-flip only).

**3. AI proactive terrain overlays (this commit):**
   - `AIAdvisor.proactiveScan` now adds `zoneName: z.name` to each issue object.
   - New `client/src/evacuation/ProactiveOverlay.js`. Pre-computes per-zone centroids. On every `advisor` socket event, calls `notify(msg)`; if msg has `zoneName` and severity is `warn`/`crit`, hovers a canvas-textured warning triangle (`!` symbol) above that zone's centroid for 8 s with pulse + bob + fade-in/fade-out, billboarded toward camera.
   - Replaces existing marker for the same zone (refresh, not stack).
   - Auto-cleanup of geometry / texture / material on expiry.
   - Closes BUILD_LOG #13/#16 (proactive AI only updated panel; nothing on terrain).

**Verification.** `npm run build` clean. `node server/_selftest.js` 25/25. `node server/_e2e.js` 14/14.

**Still open from audit:** AR / Quest 3 / HTTPS, hardware UNO physical end-to-end, 30-min / 1-hr fire projection ghost layer, real LANDFIRE / 3DEP data swap-in, mode-switch hardware "hold = ±60". Real-data swap-in is documented in the README and v3 spec — engine accepts it without code changes.

---

## 2026-05-08 — session 4

**Mode-switch UX overhaul + EVACUATE visual overlay.** Two commits, gates green throughout.

**Mode-switch UX (commit `9cd882f`):**

- **Drag → click conflict fix.** `DesktopControls` now tracks `_dragPixels` across `mousedown/mousemove`; resets on `mousedown`. `_handleCanvasClick` checks `desktop.hasDragged` (`_dragPixels > 5`) and returns early. **Camera rotation no longer accidentally blocks roads in COMMAND mode** — was the most-likely "errors interacting with the 3D map" complaint.
- **Mode toast.** New `HUD.showModeToast(mode)` creates a `#mode-toast` element with auto-dismiss after 2.5s. Fires on every `mode` socket event so hardware-board changes also surface. Descriptions: "Monitor Mode — observation only" / "Command Mode — click roads to block · voice commands active" / "Evacuation Mode — routing panel open · press E to recompute". Border + text color matches the mode label color.
- **Cursor affordance.** Canvas cursor is `crosshair` in COMMAND, `default` otherwise. In COMMAND mode, hovering a road switches cursor to `pointer`.
- **Road hover highlight.** New `mousemove` listener on the canvas raycasts the pick proxy in COMMAND mode and calls `RoadRenderer.setHover(edgeId)`. Hovered edge gets warm-yellow vertex colors. `RoadRenderer` now tracks `_primarySet` / `_secondarySet` so unhover restores the correct logical color (blocked / contra / primary / secondary / original).
- **EVACUATE auto-opens evac panel.** On entering EVACUATE, `_onModeChange` checks `snapshot.panels.evacuation` and emits a `panel` action to open it if closed.

**EVACUATE visual overlay (commit `1a3841d`):**

Every renderer now exposes `setEvacMode(active)`. `_onModeChange` in `main.js` fans it out to fire / roads / zones / routes / bottlenecks / shelters / populations on every mode change.

| Layer | Normal | Evacuate mode | How |
|---|---|---|---|
| Fire overlay | full | 22% opacity | `uFade` shader uniform, lerped 4×/s in update() |
| Road network | 0.85 opacity | 0.12 opacity | `material.opacity` lerped 5×/s |
| Highway tubes | 0.55 opacity | 0.08 opacity | per-mesh material.opacity |
| Zone fill (L3 GO) | 0.34 | 0.58 | reapply applySnapshot with `_evacMode` flag |
| Zone outline pulse | 600ms period | 400ms period | faster + higher base opacity |
| Route particles | base | size ×1.8, opacity 1.0, speed ×1.5 | applied at material level + speed mult in update |
| Bottleneck rings | base | scale ×1.4, period 250ms, opacity 0.75+ | check `_evacMode` in update |
| Shelter diamonds | emissive 0.6 | emissive 1.4, scale 1.45 | direct material assignment |
| Population dots | size 0.022, base flow | size 0.032, flow ×1.6 | material size + boost in update |

The fire CA still steps; every burning cell still visible. The evacuation geometry is now unambiguously the primary read.

**Convention added.** Renderers should expose `setEvacMode(active)`. Smooth fades preferred over instant switches — store a `_target*` value and lerp in `update(dt)`. Existing examples: `FireOverlay.uFade`, `RoadRenderer._targetRoadOpacity`.

**Verification.** `npm run build` clean (~593 kB gzipped 155 kB). `node server/_selftest.js` 25/25. `node server/_e2e.js` 14/14.

**Closes:** mode-switch behavior gap (audit Tier-1 #10), drag-click 3D-map interaction error, BUILD_LOG #11 (mode switch was cosmetic).

**Still open from audit:** AR / Quest 3 / HTTPS, hardware UNO physical end-to-end, demo scenario library, AI proactive overlays on terrain, 30-min / 1-hr fire projection ghost layer, contraflow animated visual.

---

## 2026-05-08 — session 3

**Full project audit + 7-bug fix batch + Tier-2 polish.** All changes desktop-testable; XR path untouched. Three commits, gates green throughout (selftest 25/25, e2e 14/14, build clean).

**Bug batch (commit `3bb8eee`):**

- **BUG-1 (socket.io CDN → local bundle):** `client/src/main.js:1` — was loading from `cdn.socket.io`; replaced with `'socket.io-client'` package import. Bundle +43 kB (expected). Demo no longer breaks offline.
- **BUG-2 (joystick dead event path):** `server/index.js` now handles `case 'joystick'` and `'joystick:reset'` and broadcasts them; `client/src/main.js` listens and calls `desktop.pulseRotate(dx, dy)` / `desktop.resetView()`. Three-way parity restored.
- **BUG-3 (ETA clock drift):** `EvacuationEngine` converts fire-arrival from absolute client-CA-clock to relative: `etaMin = max(0, arrivalMin − state.simTimeMin)`. Zone margins now read correctly even as clocks drift.
- **BUG-4 (`ai:transcribe` wired):** was dead code; now calls `processAdvisorPrompt(payload.transcript)` so future voice pipelines can use it as a distinct event.
- **BUG-5 (buildGraph horizonMin):** parameter was accepted but never used. Removed; filter now correctly reads `fa − simTimeMin ≤ 0` (relative, not absolute), so edges actually get removed as fire arrives.
- **BUG-6 (evacuatedPct sim-clock):** replaced `(Date.now() − lastRunAt) / 1000` with `(simTimeMin − lastRunSimMin) / evacMin`. Added `lastRunSimMin` to `StateManager.evacuation`. Time-jump now correctly moves the percentage.
- **FRAGILITY-1 (shared polyline helper):** extracted `client/src/evacuation/_polyline.js` with `bfsPolyline` + `chainPolyline`. `RouteAnimator` now calls `chainPolyline`; `PopulationDots` calls `bfsPolyline`. Both had divergent implementations before.

**Misc from bug batch:** `HUD.setFire` now renders a live fire badge in the status bar. Timeline scrubber `T` emits real `time-jump` actions (delta from `_simTimeMin`) and auto-syncs its thumb to the server clock.

**Tier-2 polish (second commit):**

- **Secondary evacuation routes:** `EvacuationEngine` now returns `secondaryEdgeIds` (next-10-by-frequency) alongside `edgeIds` (primary). `RoadRenderer.setRoutePrimary` accepts both and colors primary edges bright green, secondary dimmer green. `_applyEvacuationToScene` collects and passes both.
- **Pulsing X markers on blocked roads:** `RoadRenderer.applyEdgeUpdate` now creates a crossed-bar `THREE.Group` at the edge midpoint when a road is blocked, removes it on unblock. Pulses in `update(dt)`. Per CLAUDE.md convention, this is the third leg of the demo-script "pinch SR-67 → mark blocked" beat.
- **Bottleneck floating labels:** `BottleneckMarker` renders a canvas-texture `PlaneGeometry` label above each ring showing `NN% · hwy-class`. Labels billboard toward camera in `update`. Required adding `camera` parameter to `bottlenecks.update(dt, camera)` in `main.js`.
- **`RoadRenderer.update(dt)` hooked into render loop** in `main.js`.

**Open questions closed this session:** BUG-1 through BUG-6 from the audit. FRAGILITY-1.

**Still open (from audit):** BUG-7 (RouteAnimator rebuilds on every applySnapshot — tolerated). HTTPS / Quest 3 AR (requires hardware + network decision). Hardware UNO physical end-to-end test. Mode-switch MONITOR/EVACUATE behavior. No demo scenario library. AI proactive scan doesn't trigger terrain overlays.

---

## 2026-05-08 — session 2

**Critical gaps #4, #5, and #6 + the AI-proactive-on-time-jump rough edge from the prior session — all closed (desktop-testable; XR untouched).** Three batches landed in order; selftest + e2e gates green throughout.

**1. Proactive AI now reacts to time-jumps (`server/index.js`).** When `|deltaMin| ≥ 30`, the time-jump handler kicks `ai.proactiveScan()` immediately. Forward path defers until the client's `time-jump:applied` ack lands (so evac has re-run against the post-jump arrivalByNode); rewind path runs inline after the in-handler `evac.runFullEvacuation()`. Closes the "advisor lags up to one wall-clock minute behind a leaping sim clock" rough edge from the prior session.

**2. Voice output for advisor messages (`client/src/panels/AIAdvisorPanel.js`).** Web SpeechSynthesis speaks fresh, non-system advisor messages as they arrive. `VOICE: ON/OFF` toggle in the panel header, persisted via `localStorage` key `mm.advisorVoice`. History replay (`setHistory`) is silent. Closes Critical gap #5 — no ElevenLabs needed.

**3. AI can mutate state via voice intents (`server/services/AIAdvisor.js`, `server/index.js`).** New `parseIntents(prompt)` method on AIAdvisor returns `{ actions, summary }` in the same `{ type, payload }` action shape the keyboard / hardware paths emit. Server now funnels HTTP `/api/ai/ask`, `socket.on('ai:ask')`, and `case 'ai:transcribe'` through a single `processAdvisorPrompt(prompt)` helper that:
  1. parses intents,
  2. dispatches them through the existing `handleAction` path (so all renderers update),
  3. asks the advisor (which sees post-mutation state in `buildContext`),
  4. prepends the action summary to the reply text so the panel + voice channel announce what was done.

  Recognized intents: `Upgrade <zone> to GO|SET|READY` / `trigger evacuation for Zone A/B/C` / `Block I-15` / `Reopen SR-67` / `Enable contraflow on I-15` / `stop contraflow on SR-67`. Level detection requires explicit phrasing (`to go`, `level 3`, `trigger evac`, `stand down`, `to ready`, etc.) so casual `"how ready is Poway?"` doesn't false-trigger an override. Zone tokens accept both proper names ("Poway", "Scripps Ranch", "Ramona") and the demo-script aliases ("Zone A", "B", "C"). Road tokens cover both class names ("motorway", "trunk") and the spec's San Diego references ("I-15", "SR-67", "interstate 15", "highway 67"). Closes Critical gap #4.

**4. Population dots flow along routes (`client/src/evacuation/PopulationDots.js`).** Was: dots fade in place when a zone goes GO. Now: when a zone is at LEVEL 2 SET or LEVEL 3 GO and has a `route.edgeIds`, each dot rides a phase along an ordered polyline reconstructed from the route subgraph. Implementation: BFS from the zone's most-populous population node to the largest-share shelter through only the route's edges, then sample the resulting polyline with per-dot phase offsets so the stream looks continuous. Flow rate scales by level (GO 0.06/s, SET 0.025/s); subtle vertical sine adds liveness. `evacuatedPct` dims the stream as more residents arrive at shelters. Falls back to idle jitter if BFS can't connect (defensive — `route.edgeIds` is the top-18-by-frequency subset, not guaranteed to be a single connected path). Closes Critical gap #6.

**Verification.** `npm run build` clean (27 modules, ~543 kB). `node server/_selftest.js` 25/25 (was 18; +7 for `parseIntents`). `node server/_e2e.js` 14/14 (was 12; +2 for AI intent → state mutation round-trip).

**XR safety.** No edits to `ARSession.js`, `SceneRoot.js`, or the per-frame XR gating in `main.js`. AIAdvisorPanel is a DOM panel (still 🟡 in the panel grading — DOM not 3D Three.js planes); voice output works regardless of XR mode if the device's SpeechSynthesis is available (Quest Browser has it).

**Open questions resolved:** the proactive-cadence-vs-sim-jump question from the prior session (kicked from the time-jump handler at ≥ 30 min). Critical gap #4 (AI cannot mutate state). #5 (no voice output). #6 (population dots don't flow).

**Still open:**
- AR / WebXR untested on real Quest 3 (Critical #1–3, unchanged).
- Hardware "hold = ±60 min" still not implemented; needs the board flashed.
- `route.edgeIds` is a frequency-ranked subset, not an ordered path — `PopulationDots._buildPolyline` BFSes through it. If the engine ever returns a route that fragments into ≥ 2 components, BFS will only cover one and dots fall back to idle jitter for that zone. Acceptable; flagged here so future-me knows where to look if a zone's dots stop flowing unexpectedly.
- Voice output uses default system voice. If the demo room is loud or the default voice is bad, no voice picker UI yet.

---

## 2026-05-08

**TODO group H1/H2/H3 landed (desktop-testable; XR path untouched).** Time-jump action wired end-to-end: keyboard `[` / `]` (Shift = ±60), HUD «« / »» buttons (`client/index.html:50-51`, `client/src/ui/HUD.js:26-37`), and Arduino A2/A3 (`arduino/marshal_board/marshal_board.ino:25-26`, `server/services/ArduinoService.js:75-86`) all emit the same `{ type: 'time-jump', payload: { deltaMin } }` action shape. Three pieces of new infrastructure:

- **Client CA snapshot/restore/fastForward** (`client/src/fire/CellularAutomata.js:206-243`). Forward jumps run `_stepOnce()` N times bypassing the wall-clock rate limit; rewind restores cloned TypedArrays.
- **Server snapshot ring buffer** (`server/services/StateManager.js:52-58, 117-188`). Pushes `{ simTimeMin, weather, fire, fireArrivalByNode, evacuation, edge flags }` every 5 sim-minutes via `tickSimulation`, capped at 24 entries (~2 hr of history). `findSnapshotBefore(target)` + `applyServerSnapshot(snap)` round out the API.
- **Server time-jump dispatcher** (`server/index.js:140-187`). Forward: bumps clock, broadcasts `time-fast-forward`, client acks via new `time-jump:applied` event carrying fresh `arrivalByNode`, server then re-runs `EvacuationEngine`. Backward: finds nearest server snapshot ≤ target, restores, re-runs evac, broadcasts `time-rewind` so client can restore its CA from its own ring.

**H3 decision (was open question):** picked **snapshot ring buffer** over deterministic re-sim. Reasoning: snapshot is one-TypedArray-copy per ring slot (~80 KB × 24 = ~2 MB), no need to refactor the CA's `Math.random()` call sites to a seeded PRNG, and demo-grade fidelity is fine. Re-sim is the right answer the day multi-user (stretch goal #15) lands; defer until then.

**Hardware partial.** Firmware extended with two new pins (A2 / A3 = TIME_BACK / TIME_FWD) and the `ArduinoService` parser is backward-compatible (older 12-field firmware still works; 14-field gates the new edge-trigger). H4–H6 (Arduino UNO Q wireless migration) NOT done — needs hardware to test.

**XR safety.** No edits to `ARSession.js`, `SceneRoot.js`, or the per-frame render loop's XR gating in `main.js`. Time-jump events are socket-driven and execute identically whether `ar.active` is true or false.

**Verification.** `npm run build` clean (27 modules), `node server/_selftest.js` 18/18, `node server/_e2e.js` 12/12.

**Open questions resolved:** H3 (snapshot vs re-sim); H1 sub-question on "advance whole sim vs visualization-only" — went with whole-sim (clock + fire + evac re-runs).

**Still open:** H1 sub-question on AI proactive cadence vs sim-jump (the proactive scan still ticks on 60 s wall-clock; if simTimeMin jumps an hour ahead the advisor will be stale until the next wall-clock minute). H4/H5/H6.

### Broken / incomplete after this session

- **Rewind in the first 5 sim-minutes** surfaces an advisor warning and no-ops. The first server snapshot is pushed at simTimeMin = 5 (via `tickSimulation` in `server/services/StateManager.js`). Demo'd in `_e2e.js`; user-visible message reads "Cannot rewind: no snapshots yet…". Acceptable for now but a rough edge.
- **AI proactive scan does not re-fire on time-jump.** `setInterval(60_000)` in `server/index.js:166-170` is wall-clock. After a +60 min forward jump the advisor lags up to a wall-clock minute. Cheap fix: when `time-jump` advances by ≥ 30 sim-min, call `ai.proactiveScan()` immediately and push the result.
- **Hardware "hold = ±60" not implemented.** Classic-UNO firmware emits a single edge-trigger ±30 per press; for ±60 you press twice. Keyboard `Shift` modifier covers it. Real fix is host-side timing in `server/services/ArduinoService.js` (track press duration, fire a 2nd event after ~800 ms held).
- **Client CA snapshot ring is not pre-populated for late-joining sockets.** The `_maybeSnapCA` push in `client/src/main.js:97-105` only triggers on incoming `tick` events. A client that joins mid-session can rewind only as far back as the first `tick` it received, not as far back as the server's ring. Server `time-rewind` falls back to rebuilding a fresh CA on miss — visually the fire disappears.
- **Timeline scrubber (T) is still cosmetic.** Time-jump replaces its *role*, but the slider in `client/index.html:82-86` still emits the decorative `timeline` action. Either repurpose as a "preview without commit" tool or hide it.
- **H4 / H5 / H6 (UNO Q wireless migration) not started.** Classic-UNO USB serial path is the only working hardware path. Firmware was updated for the new pins so it stays current; no parallel `arduino/marshal_board_q/` yet.

### Next session: pick up here

Ranked by demo-credibility-per-effort, all desktop-testable, all XR-safe:

1. **Trigger `ai.proactiveScan()` from the time-jump handler when |deltaMin| ≥ 30** — `server/index.js`. ~10 lines. Removes the visible "advisor stale after jump" lag. RESUME HERE marker is parked at this exact line.
2. **Voice output for advisor messages** (Critical gap #5). Web SpeechSynthesis, ~5 lines in `client/src/panels/AIAdvisorPanel.js` (or wherever new advisor messages are appended). Speak only the latest non-system message; respect a mute toggle on the panel.
3. **AI can mutate state** (Critical gap #4). Detect intents like "Upgrade Zone B to Go", "Block SR-67", "Enable contraflow on Poway Rd" in `server/services/AIAdvisor.js` and emit the matching action. Most actions already exist (`override-zone`, `block-road`, `contraflow`); just needs a parser layer.
4. **Population dots actually flow along routes** (Critical gap #6). `client/src/evacuation/PopulationDots.js` currently fades them in place; animating along `zone.route.edgeIds` is real demo polish.
5. **Hardware hold = ±60 min** in `server/services/ArduinoService.js` — only worth doing once the board is flashed and connected.

Stop and ask before starting AR work (HTTPS / RATK / 3D panels) — that's a multi-session block of its own and needs a Quest 3 in hand to validate.

### Gotchas / context for future-me

- **The `time-jump:applied` ack is load-bearing.** The server doesn't re-run evac when a regular `fire:state` arrives — only when `time-jump:applied` arrives or a manual action triggers it. If you remove the explicit ack and try to piggy-back on `fire:state`, evac silently stops re-running after forward jumps.
- **Server and client snapshot rings are independent and not transactional.** They both push at the same 5-min sim cadence (server pushes from `tickSimulation`, client pushes from the broadcast `tick` event). They drift out of sync if the socket stalls or if the client connects late. The rewind path tolerates a client miss (rebuild CA) and a server miss (warn + no-op); don't add an assertion that requires them to match.
- **`fastForward(n)` does NOT call `setWind` / weather updates.** Weather stays whatever the last `WeatherService` poll returned, even if you forward-jump 60 min. Acceptable for short jumps; if you ever push the jump amount to 2 hr, weather divergence will get noticeable.
- **CA RNG is `Math.random()` and intentionally unseeded.** This is why H3 went with a snapshot ring instead of re-sim. Don't introduce determinism casually — it'll be a real refactor (every CA spread roll, every ember roll, every burnout-time lookup needs a seeded source). Wait for stretch goal #15 (multi-user) to motivate it.
- **`pushAdvisorMessage` is the single hub for advisor output.** New status messages from the time-jump handler go through it (see `server/index.js:155-159, 184-186`). If you wire voice output, attach it at the panel's `appendAdvisor` handler in `client/src/main.js:89` — that's where every advisor entry lands, regardless of source (proactive AI, system, user-asked, time-jump).
- **The CA's `_stepOnce` mutates `this.state` in place at the end via `this.state = next`.** `snapshot()` clones `state` before returning, but if you ever call `snapshot()` mid-step (you won't — JS is single-threaded — but if you ever go async-step), you'll get torn state. Keep `_stepOnce` synchronous.
- **A new control should be wired in three places, not two.** `CLAUDE.md` previously said hardware ↔ keyboard parity; the new convention is hardware ↔ keyboard ↔ HUD parity. The `time-jump` action is the canonical example.

## Scope Decisions (Hackathon-Realism)

The v3 spec is ambitious. To finish in 24 hours and ensure both desktop + Quest 3 work, the following adjustments are made:

| Spec Element | Hackathon Approach |
|---|---|
| OSMnx road pre-processing | **Synthetic road network** (grid + arterials + highways) generated in JS — realistic topology |
| US Census ACS population | **Synthetic population grid** mapped to road nodes |
| USGS 3DEP DEM | **Procedural simplex-noise heightmap** mimicking San Diego topography |
| LANDFIRE FBFM40 | **5-class procedural fuel grid** correlated to terrain (chaparral on slopes, urban on flats, etc.) |
| Satellite texture | **Procedural texture** generated from heightmap + fuel data |
| NASA FIRMS | **Optional**; included if API key set, otherwise scenario hotspots |
| NWS Weather | **Real API** (no key needed) with mock fallback if offline |
| Gemini AI | **Real API** if `GEMINI_API_KEY` set, else **rules-based mock advisor** that uses same context format |
| Arduino board | **Firmware + serial reader** included; **keyboard fallback** is default |
| WebXR Quest 3 | **Implemented**; desktop mode is primary and fully featured |

Every spec feature has *something* in the codebase, but not all are equally complete — see "Feature coverage vs v3 spec" and "Known gaps and v2 priorities" below for the honest grading. The ✅-everywhere matrix that originally lived here was misleading and has been replaced.

## Run Modes

1. **Desktop** (default): orbit camera, mouse + keyboard, panels as floating DOM elements over the 3D scene.
2. **Quest 3 / WebXR AR**: same scene, anchored to a detected horizontal plane; hand tracking; panels as 3D planes.
3. **Hardware board**: optional — Arduino UNO via USB serial. Keyboard always works as fallback.

## Architecture

```
client/  Vite + Three.js + WebXR
server/  Node + Express + Socket.IO + Gemini + (optional) serialport
arduino/ marshal_board.ino firmware
```

## Demo flow (matches v3 §"Demo Script")

1. Open desktop URL → terrain materializes, fire begins spreading
2. Press `1`–`4` to toggle panels (Weather / Evac / AI / Video)
3. Press `E` to trigger evacuation → zones color, routes animate, bottlenecks pulse
4. Click a road in COMMAND mode (`M` to switch) to mark blocked → routes replan
5. Hold `Space` (PTT) and ask the AI advisor a question
6. Press `R` to reset scenario

## Build Phases

- [x] Scope & plan (this file)
- [x] Phase 1: Foundation (scaffold, dual-mode renderer, terrain)
- [x] Phase 2: Fire CA + roads
- [x] Phase 3: Evacuation engine + visual rendering
- [x] Phase 4: Panels, AI, hardware, polish

## Verification

- `npm run build` — 27 modules, 540 kB gzipped 140 kB, 0 errors
- `node server/_selftest.js` — 18/18 passed (scenario, evac, AI smoke, snapshot ring buffer)
- `node server/_e2e.js` — 12/12 passed (socket round-trip incl. time-jump)
- Headless Chrome screenshot — page renders, no JS errors

## Feature coverage vs v3 spec

> **Read with skepticism.** Each row is a single developer's read of the code. 🟢 means real and validated; 🟡 means works but with substitutions or partial behavior; 🔴 means scaffolded only, untested, or visibly thin. If a status feels wrong when you load the demo, it probably is — re-grade it.

| v3 Feature | Status | What's actually there |
|---|---|---|
| 1. AR Tabletop Terrain Map | 🟡 | Heightmap and texture are **procedural**, not USGS/satellite. Plane detection / RATK anchoring **not integrated** — terrain is hardcoded `(0, 0.05, -1.2)` in front of viewer in AR. |
| 2. Live Fire Spread Simulation | 🟡 | Rothermel-lite CA + wind + slope + embers all real. Fuel grid is **procedural** (no LANDFIRE). No 30-min / 1-hr projection visuals — only current state. Timeline scrubber decorative. |
| 3. Evacuation Planning System | 🟢 / 🟡 | Engine is real (Dijkstra + BPR + capacity-aware multi-source). Operates on a **synthetic road network**. Only primary route computed (no secondary/alternate). |
| 4. Floating AR Information Panels | 🟡 | Real and styled — but **DOM, not 3D Three.js planes**. In Quest passthrough they may not appear at all. |
| 5. AI Strategic Advisor | 🟢 | Gemini path real if key set. **AI now mutates state** via `parseIntents` ("Upgrade Zone B to GO", "Block SR-67", "Enable contraflow on I-15") → real `override-zone` / `block-road` / `contraflow` actions through the same dispatcher as keyboard / hardware. **Voice output** via Web SpeechSynthesis (panel toggle). Proactive scan still only writes to panel, not terrain overlays — but now also kicks on time-jump ≥ 30 min. |
| 6. Voice + Hand + Hardware Control | 🟡 | Voice input + keyboard fallback work; voice now triggers state-mutating actions (override-zone, block-road, contraflow). **Hand tracking 0% implemented.** Gesture detection 0%. Hardware firmware written but **never validated on physical UNO**. Joystick events broadcast and consumed (session 3 BUG-2 fix), so a connected board would actually rotate the map. |
| 7. Live Data Feeds | 🟡 | NWS weather is **real**. Everything else (FIRMS / 3DEP / LANDFIRE / OSM / Census) is procedural or stubbed. |

## Run modes confirmed

| Mode | Status | Notes |
|---|---|---|
| Desktop browser (mouse + keyboard) | 🟢 | Validated via screenshot + e2e |
| Quest 3 WebXR immersive-ar | 🔴 | Code path exists; **never run on real Quest 3**. HTTPS not configured (likely required). Plane detection / hand tracking absent. |
| Hardware Arduino board | 🔴 | Firmware compiles in editor; never flashed to real UNO; serial protocol untested end-to-end. |
| AI advisor with Gemini key | 🟢 | If `GEMINI_API_KEY` set |
| AI advisor mock fallback | 🟢 | Scenario-aware, named zones, bottleneck logic |

## Known mocks & data substitutions

> Snapshot of what's procedurally generated vs sourced from real data. **The actual mock surface may be larger than this list — when in doubt, grep the file rather than trust the table.** Cost / blocker is rough; check current API pricing.

| Layer | Currently | What "real" looks like | Cost / blocker |
|---|---|---|---|
| Terrain elevation | `ScenarioBuilder.generateHeightmap` — multi-octave noise | USGS 3DEP 10m DEM tiles → PNG heightmap | Free, manual tile download per region |
| Satellite texture | `buildTerrainTexture` — canvas painted from fuel + slope | Mapbox Satellite tiles, Sentinel-2, or USGS EarthExplorer | Mapbox token (paid tier above free quota); Sentinel free with reg |
| Road network | `generateRoadNetwork` — synthetic grid + 2 highways + arterials | OSMnx `ox.graph_from_bbox(...)` → GeoJSON drop-in | Free; ~1 hr Python pre-processing |
| Population | `generatePopulations` — hand-tuned per-zone totals | US Census ACS block groups | Free key at api.census.gov |
| Fuel grid | Procedural, correlated to elevation | LANDFIRE FBFM40 raster | Free at landfire.gov |
| FIRMS hotspots | Slot in `.env.example`, **not wired** to demo | Real-time FIRMS API + new `FIRMSService.js` | Free `FIRMS_MAP_KEY` |
| NWS weather | **Real** | — | None — already live |
| Gemini AI | Mock by default; real if key set | Set `GEMINI_API_KEY` | Free tier exists |
| Voice output | **Missing** | Web SpeechSynthesis (free, ~5 lines) or ElevenLabs (paid) | None for SpeechSynthesis |
| Video feeds | Procedural canvas animations | ALERTWildfire.org embeds, or local MP4s | Free |
| Hardware board | Firmware exists for **classic UNO over USB serial**; **target is actually Arduino UNO Q over wireless** (see TODO group H below). Existing `marshal_board.ino` and `ArduinoService.js` will need a parallel UNO Q path, not deletion. | Physical UNO Q + parts list; Arduino App Lab (web IDE) instead of Arduino IDE | ~$70 UNO Q + portable battery (user has) |

## Known gaps and v2 priorities

> Ranked by demo-credibility impact based on one read of the code. **Re-rank if you have eyes on the actual demo** — the order may flip when watched on a Quest 3 or in front of judges.

**Critical (visibly missing in core demo paths):**

1. WebXR is untested on real hardware. RATK plane detection, anchors, hand tracking — none integrated.
2. AR panels stay DOM in immersive mode — likely invisible in Quest passthrough.
3. HTTPS not configured. Quest 3 WebXR generally requires it.
4. ~~Voice can't trigger actions.~~ **Closed 2026-05-08 session 2.** `AIAdvisor.parseIntents()` now translates "Upgrade Zone B to GO", "Block SR-67", "Enable contraflow on I-15", etc. into actions dispatched through `handleAction`.
5. ~~AI advisor has no voice output.~~ **Closed 2026-05-08 session 2.** Web SpeechSynthesis in `AIAdvisorPanel`, with a persisted ON/OFF toggle.
6. ~~Population dots don't actually flow along routes — they fade in place.~~ **Closed 2026-05-08 session 2.** Dots now ride a BFS-reconstructed polyline from population → top shelter when level ≥ 2.

**Medium (rough edges or cosmetic gaps from spec):**

7. No 30-min / 1-hr fire projection layer. **(Addressed 2026-05-08 sessions 2+3:** time-jump `[`/`]` + HUD buttons + scrubber all drive real `time-jump` actions. `T` scrubber now syncs to server clock and emits `time-jump` on drag. True "preview without commit" is deferred.**)**
8. ~~Engine produces only primary route; no secondary/alternate.~~ **Closed 2026-05-08 session 3.** `secondaryEdgeIds` returned per zone, rendered in dimmer green.
9. ~~Contraflow has no animated visual (color flip only).~~ **Closed 2026-05-08 session 5.** New `ContraflowAnimator` flows 6 cyan particles per contra edge from u→v at 0.45 u/s, brighter in EVACUATE.
10. ~~Blocked roads turn red but don't show pulsing X markers.~~ **Closed 2026-05-08 session 3.** Pulsing crossed-bar markers added to `RoadRenderer`.
11. ~~Mode switch is ~cosmetic (only COMMAND has behavior).~~ **Closed 2026-05-08 session 4.** Mode toast fires on every mode change; cursor affordance + road hover highlight in COMMAND; EVACUATE auto-opens evac panel and applies a global visual overlay (fire dims to 22%, evac layer brightens, route particles 1.8× size, etc.). All renderers expose `setEvacMode(active)`.
12. `data/demo-scenarios/` is empty. No saved Cedar Fire scenario states.
13. ~~Proactive AI only updates the panel — no terrain overlays.~~ **Closed 2026-05-08 session 5.** New `ProactiveOverlay` hovers an 8-second pulsing warning triangle above the named zone whenever a `warn`/`crit` advisor message lands.
14. Performance on Quest 3 untested. May need 64×64 CA fallback.

**Stretch (spec stretch goals or polish):**

15. Multi-user — broadcast already shaped for it; no UI/lobby.
16. Historical replay — load real 2003 Cedar Fire FIRMS timeline.
17. Phone companion — Leaflet 2D mirror.
18. Sound design — alarms, click feedback, radio chatter.
19. Bottleneck markers don't show capacity %, hwy class, or alt routes.
20. Shelter overflow has no UI signal.
21. ~~Reset only re-seeds the same scenario; no scenario picker.~~ **Closed 2026-05-08 session 5.** Three named scenarios with distinct ignition points; `<select>` in HUD bottom strip emits `reset { scenarioId }`.

### TODO group H — time-control buttons + UNO Q migration *(supersedes / refines item 7 above and the Hardware row in §"Known mocks")*

> User-requested addition. Two physical buttons on the hardware board for jumping the simulation forward/back in time, **plus a platform migration** of the entire hardware integration from classic UNO + USB serial to Arduino UNO Q + wireless. The two are bundled here because both touch firmware and `ArduinoService.js`, and doing them together avoids two firmware rewrites.

**H1 — Two new hardware controls.** ✅ **Shipped 2026-05-08.** Forward (`TIME_FWD`) and back (`TIME_BACK`) buttons on classic-UNO firmware (A3 / A2). Forward jumps `simTimeMin` by +30 (or +60 with keyboard `Shift+]`), fast-forwards the fire CA, and re-runs `EvacuationEngine`. Back rewinds to the nearest snapshot. Hardware "press and hold = ±60" not implemented — use two presses or the keyboard shortcut. Keyboard fallback `[` / `]` (Shift = ±60) and HUD «« / »» buttons mirror the same action. Validated end-to-end on desktop; physical-board path is wired but never flashed (firmware backward-compatible with the old 12-field protocol).

**H2 — Server-side time-jump API.** ✅ **Shipped 2026-05-08.** `socket.emit('action', { type: 'time-jump', payload: { deltaMin: ±30|±60 } })`. Forward: server advances `simTimeMin`, broadcasts `time-fast-forward { steps, targetMin }`, client fast-steps CA and acks via `time-jump:applied { arrivalByNode, fire }`, server re-runs evac. Backward: server picks nearest snapshot ≤ target, calls `applyServerSnapshot`, re-runs evac, broadcasts `time-rewind { targetMin }` so the client can restore its own CA from its local ring. Both paths broadcast a fresh snapshot.

**H3 — Reverse-time strategy.** ✅ **Decided 2026-05-08: snapshot ring buffer.** Every 5 sim-minutes push `{ simTimeMin, weather, fire, fireArrivalByNode, evacuation, edge flags }` onto a 24-entry buffer (~2 hr of history). Server uses one ring; client uses a parallel CA-only ring at the same cadence. Why this and not deterministic re-sim: snapshot path is ~80 KB × 24 = ~2 MB total, requires no PRNG refactor, and is one TypedArray copy per slot. Re-sim is correct for multi-user / replay but is a multi-hour refactor; defer until stretch goal #15 actually needs it.

**H4 — Migrate firmware target to Arduino UNO Q.** 🔴 **Not started.** Existing `arduino/marshal_board/marshal_board.ino` is for classic UNO + Arduino IDE. UNO Q uses **Arduino App Lab** (web IDE, different sketch conventions, can leverage onboard MPU/Linux side). Add `arduino/marshal_board_q/` as the new authoring location. **Keep the classic UNO sketch as a reference** — don't delete; it's a working CSV protocol the wireless path can mirror. (As of 2026-05-08 the classic sketch is updated for H1's new pins and is still the only path.)

**H5 — Drop USB serial; move to wireless.** 🔴 **Not started.** UNO Q has WiFi / BLE built in and will be powered by a portable battery, untethered. Replace `ArduinoService.js`'s `serialport` reader with a network endpoint:
  - Recommended: UNO Q runs a WebSocket *client* and connects to the server's existing Socket.IO (or a dedicated `/board` namespace), POSTs button events as the same `{ type, payload }` action shape the keyboard fallback uses.
  - Alternatives: MQTT broker (extra moving part); HTTP POST per event (chatty but simple); BLE (only if the server host is also a BLE peripheral, which complicates deployment).
  - Existing `ArduinoService.js` should stay as a fallback path (USB still works for development on a laptop) but the production target is the WiFi path.

**H6 — Pairing / discovery UX.** 🔴 **Not started.** Without USB autodetect, the user needs a way to connect the board to the running server. Likely: server prints a join URL or 6-digit code at startup; UNO Q prompts (or is pre-configured) with WiFi SSID + server URL.

## Open questions (for future sessions to interpret)

> These are things the prior session **wasn't sure about** rather than things it already concluded. Treat each as a starting point, not an answer. Add to this list as you find new ones.

- Does WebXR actually work on a Quest 3 with the current ARSession? Untested. Failure modes unknown.
- Is HTTPS strictly required for `immersive-ar` on Quest 3 in 2026? Spec said yes; verify before assuming a self-signed cert is enough.
- Is the BPR cap of 6× sensible on a real OSM-derived network? Tuned against synthetic; behavior on a 10k+ edge graph not validated.
- Fire CA at 128×128 — does it sustain 60fps in a Quest 3 browser? Unknown. May need to drop to 64×64 or move to a GPU shader CA.
- Should fire-arrival time be derived from a forward simulation (run CA without rendering) rather than the live arrival map? Current approach lets the player out-run the engine.
- Is `Math.random()` allowed in client-side fire CA? Currently yes. If determinism per session matters (replay, multi-user), seed it.
- Are there mocks I missed that are subtle enough to pass a quick read? Examples worth re-checking: shelter capacity vs actual road-segment-throughput math, the headway/BPR window relationship, whether `arrivalByNode` correctly handles disconnected components, whether the road-pick proxy alignment is right when terrain is rotated.
- Does the proactive AI (60s tick) ever produce surprising / wrong warnings on edge scenarios (e.g. zone with zero fire ETA, zone with margin == exactly 0)?
- The "evacuated %" is a wall-clock-since-evac-trigger linear ramp — not a real flow simulation. Looks fine but is fake. Keep or replace?
- The `simTimeMin` clock advances independently of fire-CA stepping. They should probably be coupled. Are they drifting apart in long sessions?
- Does the AR session correctly destroy itself / restore desktop on `session.end()`? Path is written but never exercised.
- ~~(H3) For time-rewind: snapshot ring buffer vs deterministic re-sim — which is right?~~ **Resolved 2026-05-08: snapshot ring buffer.** See TODO group H3 above.
- (H4) Does Arduino App Lab support standard `.ino`-style sketches, or does it require a different project layout / build manifest? Confirm before porting.
- (H5) Is the WiFi / WebSocket round-trip fast enough for the joystick (~30 Hz)? Buttons are edge-triggered so latency tolerance is high, but joystick streaming may need throttling or a different transport.
- (H5) If the UNO Q drops WiFi mid-demo, what's the failure UX? Currently nothing — keyboard fallback masks it but there's no visible "board offline" indicator.
- ~~(H1) Should "forward 30 min" advance the *whole* sim (clock + fire + weather + evac), or just the fire-projection visualization layer?~~ **Resolved 2026-05-08: whole sim.** Server bumps `simTimeMin`, client fast-steps the CA, evac re-runs against the new arrivalByNode. Weather is not re-fetched on jump — it stays whatever the last NWS poll returned (acceptable since jumps are short).
- (H1) On forward-jump, does the AI advisor's proactive scan also re-run, or stay on its 60-second wall-clock cadence? **As of 2026-05-08: still wall-clock.** The proactive `setInterval(60_000)` in `server/index.js` is unaware of sim-jumps. After a +60 min jump the advisor lags up to one wall-clock minute. Cheap fix: kick `ai.proactiveScan()` from the time-jump handler if the delta is large.
- (Snapshot ring buffer) Client and server rings are independent and pushed at the same 5-min sim cadence, but the server pushes from `tickSimulation` (driven by wall-clock `setInterval`) while the client pushes from the server's `tick` event. They should stay in sync as long as the socket isn't stalled; if a client connects mid-session it has no history. Acceptable for the demo but worth flagging.

## Re-grading guidance

When the next session opens this repo, suggested 5-minute pass:
1. Run `npm run dev`, open browser, press `E`, click a road in Command mode, hold Space and ask a question.
2. Compare the experience to each 🟢 / 🟡 / 🔴 row above.
3. **If a 🟢 looks weaker than claimed, downgrade it and add a note.** Over-stating progress is the failure mode that costs the next session the most time.
4. Skim the "Open questions" section for anything that's now answerable from observation, and resolve those entries (move them up to known gaps or delete them).
