# Marshal Management — Build Log

**Hackathon:** Reboot the Earth 2026 | UCSD | May 8–9, 2026
**Status:** In Progress

---

## 2026-05-09 — session 20 (dot direction, cluster unblock, shelter visibility, more zones)

User-reported issues after session 19:

1. **X markers persist after each click cycle** — cluster-block placed N X's; clicking removes only one.
2. **Dots flow OUT of Qualcomm Stadium** in EVACUATE mode — wrong direction.
3. **Compromised-shelter indicator invisible** at desktop zoom.
4. **Shift+click on terrain doesn't add a shelter** — road pick wins first.
5. **Only 3 zones** — wants more, plus another shelter distinct from any zone.
6. **Smooth dot motion** — flow has to read clean.

### Diagnosis

- **Dot direction**: `EvacuationEngine.runFullEvacuation` builds `z.route` without `startNodeId`/`endNodeId`. `RouteAnimator._edgesToPolyline` falls through to `chainPolyline` (greedy edge-walker, orientation depends on input order) → particles ride shelter→population. `PopulationDots` already uses direction-deterministic `bfsPolyline` — bug is RouteAnimator-only.
- **Cluster persistence**: session 19 added cluster-block via BFS through same-class adjacency but kept unblock surgical. Asymmetric — fix is symmetric BFS.
- **Compromised indicator**: `_applyCompromisedState` shows 0.085-radius ring; few pixels at zoom ~18.
- **Shelter designation priority**: 19k pickable major roads, almost any click hits a road first.

### Plan

- **P0** `EvacuationEngine.runFullEvacuation`: emit `startNodeId` + `endNodeId` on `z.route` from `topPaths[0]`.
- **P0** `StateManager.blockRoad(edgeId, false)`: extend through same-class adjacency to all currently-blocked neighbors. One click clears the cluster.
- **P1** `ShelterMarker._applyCompromisedState`: replace subtle ring with big red X-bar mesh + "COMPROMISED" canvas label + stronger desaturation, all grouped.
- **P1** `main.js _handleCanvasClick`: when `ev.shiftKey` in COMMAND mode, designate-shelter wins over road/shelter pick. Add HUD toast on entering COMMAND that says "Shift+click on terrain to add shelter".
- **P1** `ScenarioBuilder`: add 3 zones (Mira Mesa, Rancho Peñasquitos, La Jolla/UCSD) + 1 shelter (SDSU Aztec Stadium 32.7745,-117.0823). Total 6 zones, 5 shelters at boot.

---

## 2026-05-09 — session 19 (fire stop bug + block-road dots + shelter management)

### Issues + diagnosis

1. **Fire stops mid-map.** `ScenarioBuilder.generateFuelGrid` thresholds `h < 0.18 → ROCK` against a normalized real DEM (0–1616m). All populated valleys (<290m) classified ROCK = no fuel. `carveUrban` calls used hardcoded grid coords from the original bbox — misaligned after bbox change.
2. **Dots flow through "blocked" roads.** `EvacuationEngine.buildGraph` correctly excludes blocked edges, but clicking I-15 only blocks one ~500m segment between intersections. Dijkstra reroutes locally via the next adjacent edge; visual "I-15 corridor" still flows.
3. **No shelter management** — feature gap.

### Outcomes

- **Fire spread (P0):** ROCK threshold dropped 0.18 → 0.03. Urban-carve centers reprojected via `latLngToGrid()` for Scripps Ranch/Poway/Ramona; added Mira Mesa, Mission Valley/Qualcomm, Rancho Peñasquitos. Verified fuel mix: ROCK 11.2%, GRASS 24.9%, CHAPARRAL 39.2%, TIMBER 16.1%, URBAN 8.6%.
- **Block-road extension (P0):** `StateManager.blockRoad` BFSes through same-class adjacency, capped per class (motorway 6, trunk 5, primary 4, *_link 2-3, residential 1). Each affected edge emits `edge:update`. Unblock path stayed surgical (asymmetric — fixed in session 20).
- **Shelter management (P1):** `compromised` field on every shelter (default false); `EvacuationEngine` filters compromised out of `availableShelters`. New `compromise-shelter` (toggle, never deletes) and `designate-shelter { gx, gy, name?, capacity? }` actions; both broadcast updated `shelters` + re-run evac. `ShelterMarker` got `pickGroup` (diamond-only raycasting) + `pickShelter()` + `_applyCompromisedState()` + `syncShelters()`. `main.js` COMMAND-mode click priority: shelter diamond → road pick → Shift+terrain. New `worldToGrid(x,z)` inverse on `TerrainMesh`.

Gates 25/25, e2e 14/14, build clean.

---

## 2026-05-09 — session 19b (UNO Q hardware migration + PTT removal + mode-cycle action)

User confirmed pre-code: WiFi/Python transport (not USB serial), full removal of PTT/voice-input.

### Research-driven gotchas (worth keeping)

- UNO Q USB-C is bridged to the MPU/Linux side. `Serial.println()` from a sketch goes to D0/D1 hardware pins, not App Lab console. Use `Monitor.println()` from `<Arduino_RouterBridge.h>`.
- UNO Q GPIO is 3.3 V; analog pins NOT 5 V tolerant. Joystick → 3V3 rail.
- App Lab projects need fixed layout: `app.yaml`, `sketch/{sketch.ino,sketch.yaml}`, `python/{main.py,requirements.txt}`. MCU FQBN `arduino:zephyr:unoq`.
- WiFi/BT live on the MPU side. No first-party `WiFi.h` for sketch on Zephyr core. Architecture: sketch → `Bridge.notify(...)` → Python on Linux → `python-socketio>=5.11` → Node server.

### Implementation

- **`arduino/marshal_board_q/`** new App Lab project. Sketch: INPUT_PULLUP buttons D2–D8 with 20ms debounce, joystick A0/A1 deadzone 60 + 33ms throttle. Python: `Bridge.provide(...)` handlers, auto-reconnecting Socket.IO client to `SERVER_URL`. Classic-UNO sketch in `arduino/marshal_board/` untouched per CLAUDE.md.
- **`mode-cycle` action** new — server accepts `{type:'mode-cycle'}` alongside absolute `{type:'mode',payload:...}`. Cycle: MONITOR → COMMAND → EVACUATE → MONITOR via `StateManager.cycleMode()`. HUD button + keyboard `M` + hardware all funnel through this.
- **PTT fully removed.** Deleted `client/src/interaction/VoiceInput.js`. Touchpoints cleaned across Keybindings, main.js, HUD, index.html, styles.css, EvacuationPanel, server/index.js, StateManager, ArduinoService. Voice OUTPUT (SpeechSynthesis in AIAdvisorPanel) retained — independent of input pipeline.
- **`AIAdvisor.parseIntents()` retained** for typed input / future text entry.

### Action mapping (parity rule)

| Hardware | Python emit | Server handler |
|---|---|---|
| D2 (joy click) | `{type:'joystick:reset'}` | `state.broadcast('joystick:reset', {})` |
| D3 Weather | `{type:'panel',payload:'weather'}` | `state.togglePanel('weather')` |
| D4 Evac | `{type:'panel',payload:'evacuation'}` | `state.togglePanel('evacuation')` |
| D5 AI | `{type:'panel',payload:'advisor'}` | `state.togglePanel('advisor')` |
| D6 Video | `{type:'panel',payload:'video'}` | `state.togglePanel('video')` |
| D7 Mode | `{type:'mode-cycle'}` | `state.cycleMode()` |
| D8 Reset | `{type:'reset'}` | `state.resetScenario(...)` |
| A0/A1 | `{type:'joystick',payload:{dx,dy}}` | `state.broadcast('joystick', payload)` |

Open: `Bridge.provide` symbol availability per-image (forum reports, not docs); mDNS discovery; physical UNO Q test pending user setup.

---

## 2026-05-08 — session 18 (Quest 3 LAN testing setup)

WebXR `immersive-ar` requires HTTPS even over LAN. Installed `@vitejs/plugin-basic-ssl@^1.2.0` (v1 — v2+ requires Vite 6, we have Vite 5). `vite.config.js`: `server.https: true` + `proxy { changeOrigin: true }` so the upstream HTTP server sees the right Host header. Added `listLanIps()` startup banner in `server/index.js`. New `QUEST_SETUP.md` documents cert click-through, AR caveats (no plane detection, DOM panels likely invisible in passthrough, no hand tracking, terrain at fixed offset), and cloudflared as alternative if Quest can't reach LAN. Actual `Enter AR` on Quest 3 still untested — this session enabled the prereqs.

---

## 2026-05-08 — session 17 (ember particles + map expansion + west-focus camera)

- **E2 ember particles:** CA's ember-spotting (active when `windKph > 25`) was silent. `CellularAutomata` now records each ember as `{from, to}` in a bounded queue (max 60); new `consumeEmberEvents()` drains per frame. New `client/src/fire/EmberAnimator.js` — fixed-pool `THREE.Points` (25 slots), parabolic arc (1.2s lifetime, peak 0.4 scene units, warm orange 0xffa844). Single spark every ~3s at 35 kph; 3–8 simultaneous at Santa Ana 60 kph.
- **Map expansion:** `TERRAIN_WORLD` 9 → 11, `TERRAIN_HEIGHT` 1.0 → 1.2. `DesktopControls.center` (0,0,0) → (-3.0, 0, 0.5) — west-focus on populated cluster (Scripps Ranch/Poway/Mira Mesa). `distance` 14 → 16. East-edge Cedar Creek still in frame at default.

---

## 2026-05-08 — sessions 14–16 (Tier A NIFC + Tier D fade/styling/onboarding)

- **NIFC Cedar perimeter (A2):** `server/services/PerimeterService.js` queries NIFC ArcGIS `InterAgencyFirePerimeterHistory_All_Years_View` for `INCIDENT='CEDAR' AND FIRE_YEAR=2003` (and Witch 2007). Filters polygons ≥10 points, sorts by acreage. Live: 270,686 acres (vs documented 273,246). Cached `data/perimeter-cedar.json`. Client `PerimeterOverlay.js` builds `THREE.Shape` + `ShapeGeometry`; toggle via **F**.
- **Census tracts (A3):** `CensusService` queries ACS 2022 `for=tract:*&in=state:06+county:073` after city fetches. 737 tracts, median 4,282/tract, max 38,907. Surfaced as `state.census.tracts` + AI context line + EvacuationPanel footnote. Per-node tract distribution deferred (needs Tiger/LINE shapefile + spatial join).
- **A1 LANDFIRE FBFM40 deferred:** `lfps.usgs.gov` ArcGIS returns rendered PNG (loses class codes) or LERC/TIFF (needs geotiff.js). Procedural fuel adequate for demo.
- **D4 fire-blocked styling:** new `_fireBlockedSet` on `RoadRenderer`. Charred dark gray, no X marker. Refactored to single `_recolorEdge(arr, edgeId)` with priority: hover > user-blocked > fire-blocked > contraflow > primary > secondary > original. New `applyFireBlocking(edgeIds)` with dirty-tracking. `main.js _refreshFireBlockedEdges(simTimeMin)` walks scenario edges against `arrivalByNode`. Visual: red = "I closed it", gray = "fire took it", green = active route, cyan = contraflow.
- **D2 onboarding overlay:** restructured `?` help into Modes / Essentials / Camera / Voice / What's real sections. Auto-shown on first launch via `localStorage` `mm.helpSeen`. Color-coded mode pills.
- **D3 route fade transition:** `RouteAnimator._fadingOut[]` captures superseded entries; new routes built at opacity 0 with `fadeInStart`. `update(dt)` lerps both flows over 600ms. Mode change snaps to target opacity (no fade collision).
- **D5 PTT transcription legibility:** font 12→14, max-width 70vw, word-break, color #ffd9d9.

Map expansion (session 14): `TERRAIN_WORLD` 6 → 9, distance range 3.5..30 → 2.0..70.

---

## 2026-05-08 — session 13 (status review + tier plan, NO CODE)

### Tier breakdown (still partly open)

**Tier A — last "real data" pieces:** A1 LANDFIRE deferred. ✅ A2 NIFC perimeter, ✅ A3 Census tracts (lightweight).

**Tier B — AR / Quest 3:** ✅ B1 HTTPS done (session 18). B2–B5 (validate immersive-ar, 3D AR panels, RATK plane detection, hand tracking) all pending — need on-headset feedback.

**Tier C — Hardware:** C1 (flash classic UNO + USB serial validation) untested. C2 (hold = ±60 host-side timing) not done. ✅ C3 UNO Q migration done (session 19b).

**Tier D — Polish:** ✅ D2 onboarding, ✅ D3 fade, ✅ D4 fire-blocked styling, ✅ D5 transcription legibility. D1 (perf audit at 15k OSM edges) pending. D6 (demo savepoints) blocked by unseeded CA RNG.

**Tier E — Engine refinements:** E1 30/60-min ghost projection layer, ✅ E2 ember particles (session 17), E3 hypothetical "what-if" mode, E4 slope physics re-tuned to real DEM.

### Risks / gotchas (re-flagged)

1. Late-joining socket clients have no replay history — server's snapshot ring is server-side.
2. Performance unknown at full real-OSM density (15k edges). Pick proxy especially.
3. CA `Math.random()` is unseeded — same scenario seed produces different fire each run.
4. AR completely unvalidated on real Quest 3.
5. `WindIndicator` + `CompassMarkers` parented to terrain group; sprite scaling under scaled parents not verified in AR.
6. Slope physics not re-tuned for real DEM (multiplier `* 50` is procedural-noise-tuned).
7. OpenAI / FIRMS / Census keys in `.env` (gitignored). Rotate after demo.

---

## Sessions 1–12 — historical summary

Compressed for performance. Each line: what changed; details live in git history.

- **Session 12 (2026-05-08):** CompassMarkers (3D N/S/E/W sprites, red north). WindIndicator (3D ArrowHelper at NE corner pointing wind TOWARD direction; pulses on Red Flag). CA stepping synced to server clock at 0.5 sim-min/wall-sec via `STEP_INTERVAL` 0.4s → 1.0s. `tick` handler hard-syncs `fireCA.simMinutes = simTimeMin`.
- **Session 11:** Real USGS 3DEP terrain via `TerrainService.js` — EPQS at 33×33 = 1089 points, bilinear-resampled to 128×128. San Diego 7m–1259m. Cached `data/cedar-corridor-dem.json`. EPQS gotcha: `value` is a string, needs `parseFloat`. HUD `🌐 OSM+3DEP` badge. `block-road` action emits route-diff advisor messages with Jaccard overlap < 0.6 threshold.
- **Session 10:** Real San Diego bbox + `latLngToGrid()`. All scenario data driven by real lat/lng (Scripps Ranch, Poway, Ramona, Cedar 2003 ignition 33.0356/-116.7, Witch 2007 33.0833/-116.7167, Qualcomm Stadium shelter 32.7831/-117.1196). New `OSMService.js` queries Overpass API on startup → 12,812 nodes / 15,418 edges. Topology compression collapses shape-only nodes ~20×. Filters to motorway/trunk/primary/secondary/tertiary + `*_link`. Cached `data/osm-cedar.json`. Removed `level < 2` filter so all zones always show routes.
- **Session 9:** Census socket wired (`socket.on('census')` was missing). WeatherPanel fire-conditions interpretation (LOW/MOD/HIGH/EXTREME spread potential, spotting risk, Red Flag distance). EvacuationPanel road names derived from `hwy` types (motorway → I-15, trunk → SR-67).
- **Session 8:** Wind penalty in `EvacuationEngine.buildGraph()` — up to ×1.25 multiplier on edges aligned with fire spread direction (active when wind > 20 kph). Red Flag proactive alert (fires once per event via `_redFlagAlerted`). EvacuationPanel zone-row action hints (no-route/imminent/critical/overloaded/tightening/clearing). Dynamic evac banner with wind direction + Red Flag badge.
- **Session 7:** Server tick 1000ms/+0.5 → 2000ms/+1 sim-min. HUD HH:MM 24-hour anchored to scenario `ignitionTime`. Pause/resume via `sim:toggle` / `setPaused`. Blocker unselect bug: client `edge:update` now syncs scenario.edges blocked/contra so re-click unblocks. Click-zone-to-cycle-level in EVACUATE. Real Census via `CensusService.js` (San Diego County 3,289,701; City 1,383,987; Poway 48,737; Escondido 61,942).
- **Session 6:** AI swap Gemini → OpenAI gpt-4o-mini (`max_tokens: 220, temperature: 0.25`). `FIRMSService.js` polls VIIRS_SNPP_NRT every 30 min for CA bbox; HUD `🛰 N CA hotspots` badge. Real Cedar 2003 / Witch 2007 metadata (acreage, fatalities, evacuee counts, Santa Ana wind). `MM_FORCE_MOCK=1` for hermetic e2e.
- **Session 5:** `SCENARIOS` dict with three named presets sharing seed 42 — Cedar Fire (NE), Witch Creek (far east), Plumas Approach (west). HUD scenario `<select>`. `ContraflowAnimator.js` — 6 cyan particles per contra edge at 0.45 u/s. `ProactiveOverlay.js` — 8s pulsing warning triangle above named zone on warn/crit messages.
- **Session 4:** Mode-switch UX: drag-vs-click fix (`_dragPixels > 5` cancels click), `HUD.showModeToast(mode)` with auto-dismiss, cursor `crosshair` in COMMAND, road hover highlight via `RoadRenderer.setHover(edgeId)`, EVACUATE auto-opens evac panel. EVACUATE visual overlay: every renderer exposes `setEvacMode(active)`; fire 22% opacity, road 0.12 opacity, route particles ×1.8 size + ×1.5 speed, shelter emissive 0.6 → 1.4. Convention: smooth fades via `_target*` lerp in `update(dt)`.
- **Session 3:** 7-bug fix batch — socket.io CDN → local bundle, joystick event path wired, ETA clock drift (relative `etaMin`), `ai:transcribe` connected, `buildGraph` uses relative `fa - simTimeMin`, `evacuatedPct` uses sim-clock not wall-clock, shared polyline helper `_polyline.js`. Tier-2 polish: secondary routes (`secondaryEdgeIds`), pulsing X markers on blocked roads, bottleneck floating labels.
- **Session 2:** `AIAdvisor.parseIntents()` (block/upgrade/contraflow). Voice output via Web SpeechSynthesis with `mm.advisorVoice` toggle. Population dots flow along BFS-reconstructed polyline (was: fade in place). Proactive AI kicks on time-jump ≥ 30 min.
- **Session 1 (TODO group H):** Time-jump action wired keyboard `[`/`]` (Shift = ±60) + HUD «« / »» + Arduino A2/A3, all emit `{type:'time-jump',payload:{deltaMin}}`. Client CA snapshot/restore/fastForward. Server snapshot ring buffer (24 entries × 5 sim-min ≈ 2hr). Time-jump dispatcher with `time-jump:applied` ack and `time-rewind` rollback. **H3 decision: snapshot ring buffer over re-sim** (~80 KB × 24 = ~2 MB; no PRNG refactor needed).

### Persistent gotchas worth re-stating

- **`time-jump:applied` ack is load-bearing.** Server doesn't re-run evac on regular `fire:state` — only on this ack or manual action.
- **Server and client snapshot rings are independent.** Drift if socket stalls or client connects late. Rewind path tolerates miss (rebuild fresh CA on miss).
- **`fastForward(n)` does NOT call `setWind`.** Weather stays at last NWS poll value across jumps.
- **CA RNG is `Math.random()`, intentionally unseeded.** Don't add determinism casually — every CA spread roll, ember roll, burnout-time lookup needs a seeded source. Wait for stretch goal #15 (multi-user) to motivate.
- **`pushAdvisorMessage` is the single hub for advisor output.** Wire new sources here; client-side `appendAdvisor` handler in `main.js` is where every entry lands.
- **A new control wires in three places, not two.** Hardware ↔ keyboard ↔ HUD parity. `time-jump` is the canonical example.

---

## Scope Decisions (Hackathon-Realism)

| Spec Element | Hackathon Approach |
|---|---|
| OSM road network | **Real** — Overpass live (12.8k nodes / 15.4k edges, cached) |
| US Census ACS | **Real** — county/city + 737 tracts |
| USGS 3DEP DEM | **Real** — EPQS 33×33 → 128×128 (cached) |
| LANDFIRE FBFM40 | **Procedural** — 5-class grid correlated to terrain |
| Satellite texture | Procedural canvas from fuel + slope |
| NASA FIRMS | **Real** if `FIRMS_MAP_KEY` set |
| NWS Weather | **Real** (no key needed) with mock fallback |
| OpenAI gpt-4o-mini | **Real** if `OPENAI_API_KEY` set, else mock advisor |
| Arduino board | UNO Q App Lab (WiFi/Python/Socket.IO); classic UNO USB sketch retained as reference |
| WebXR Quest 3 | HTTPS infra ready; on-headset validation pending |

## Run Modes

1. **Desktop** (default, primary): orbit camera, mouse + keyboard, DOM panels.
2. **Quest 3 / WebXR AR**: same scene, hardcoded offset (no plane detection yet); panels likely invisible in passthrough.
3. **Hardware board**: UNO Q over WiFi (production target, untested live); classic UNO over USB (reference, also untested live). Keyboard always works as fallback.

## Architecture

```
client/  Vite + Three.js + WebXR
server/  Node + Express + Socket.IO + OpenAI + (optional) serialport
arduino/ marshal_board (classic UNO ref) + marshal_board_q (App Lab production target)
```

## Demo flow

1. Open browser → terrain materializes, fire spreads from Cedar Creek.
2. `1`–`4` toggle panels (Weather / Evac / AI / Video).
3. `E` triggers evacuation → zones color, routes animate, bottlenecks pulse.
4. COMMAND mode (`M` cycles): click road to block (cluster blocks N edges); Shift+click terrain adds shelter; click shelter diamond toggles compromised.
5. `F` overlays real 2003 Cedar Fire NIFC perimeter.
6. `[` / `]` time-jump ±30 (Shift = ±60); `P` pause; `R` reset.

## Verification

- `npm run build` — clean (~640 kB / ~169 kB gz)
- `node server/_selftest.js` — 25/25
- `node server/_e2e.js` — 14/14 (hermetic via `MM_FORCE_MOCK=1`)

## Feature coverage vs v3 spec

> Read with skepticism. 🟢 = real and validated; 🟡 = works with substitutions; 🔴 = scaffolded only or visibly thin.

| v3 Feature | Status | What's there |
|---|---|---|
| 1. AR Tabletop Terrain Map | 🟢 desktop / 🔴 AR | Real DEM + OSM + compass + wind arrow on desktop. AR untested on Quest 3. |
| 2. Live Fire Spread Simulation | 🟢 | Synced to server clock; wind asymmetry (4.3× downwind vs upwind at 35 kph); ember spotting visible. Fuel still procedural. |
| 3. Evacuation Planning System | 🟢 | Capacity-aware Dijkstra + BPR + wind penalty + multi-shelter overflow + connected paths + secondary routes + reroute advisor messages. |
| 4. Floating AR Information Panels | 🟢 desktop / 🔴 AR | DOM works on desktop; AR needs 3D pane port. |
| 5. AI Strategic Advisor | 🟢 | OpenAI + voice output + intent → state mutation + proactive scan with terrain warning triangles + reroute messages. |
| 6. Voice + Hand + Hardware Control | 🟡 | Voice input REMOVED (session 19b). Joystick wired. Hardware never validated on physical board. Hand tracking 0%. |
| 7. Live Data Feeds | 🟢 | NWS + FIRMS + Census + OSM + 3DEP + NIFC perimeter all live. |

## Known gaps and open priorities

**Critical:**

1. WebXR untested on real Quest 3. RATK plane detection / anchors / hand tracking — none integrated.
2. AR panels stay DOM in immersive mode — likely invisible in Quest passthrough.
3. Hardware (UNO Q or classic UNO) never validated on physical board.

**Medium:**

4. No 30-min / 1-hr fire projection ghost layer (E1).
5. `data/demo-scenarios/` empty — no canonical savepoints (gated on seeding CA RNG).
6. Performance on Quest 3 untested. May need 64×64 CA fallback.
7. Performance audit at full real-OSM density (15k edges) — pick proxy raycasting, especially.
8. LANDFIRE FBFM40 fuel still procedural.

**Stretch:**

9. Multi-user (broadcast already shaped for it; no UI/lobby).
10. Historical replay — load real 2003 Cedar Fire FIRMS timeline.
11. Phone companion — Leaflet 2D mirror.
12. Sound design — alarms, click feedback, radio chatter.
13. Shelter overflow has no UI signal.
14. Slope physics not re-tuned for real DEM (multiplier `* 50` is procedural-noise-tuned).

## Open questions

- Does WebXR work on a Quest 3 with the current ARSession? Untested.
- Is HTTPS strictly required for `immersive-ar` on Quest 3 in 2026? Self-signed cert ready; verify on hardware.
- BPR cap of 6× — sensible on real OSM density?
- Fire CA at 128×128 — sustains 60fps on Quest 3 browser?
- Should fire-arrival time come from a forward simulation (CA without rendering) instead of live arrival map? Current approach lets the player out-run the engine.
- "evacuated %" is wall-clock-since-evac-trigger linear ramp — fake but looks fine. Keep or replace?
- Does AR session correctly destroy itself / restore desktop on `session.end()`? Path is written but never exercised.
- (UNO Q) `Bridge.provide` symbol availability per App Lab image — forum reports, not docs. Fall back to `dir(Bridge)` enumerate if `AttributeError`.
- (UNO Q) WiFi/WebSocket round-trip fast enough for joystick (~30 Hz)? Throttling may be needed.
- (UNO Q) Failure UX if board drops WiFi mid-demo? Currently no "board offline" indicator.

## Re-grading guidance

Suggested 5-minute pass for the next session:

1. Run `npm run dev`, press `E`, click a road in COMMAND mode, ask AI a typed question.
2. Compare to each 🟢 / 🟡 / 🔴 row.
3. Downgrade any 🟢 that looks weaker than claimed.
4. Move resolved "Open questions" to gaps or delete.
