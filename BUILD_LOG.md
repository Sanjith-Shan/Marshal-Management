# Marshal Management — Build Log

**Hackathon:** Reboot the Earth 2026 | UCSD | May 8–9, 2026
**Status:** In Progress

---

## 2026-05-09 — session 19 (plan: fire stop bug + block-road dots + shelter management)

### Problem report

User testing surfaced three issues:

1. **Fire stops mid-map and fails to progress.** Fire ignites at Cedar Creek but freezes well before reaching populated areas.
2. **Dots still flow through "blocked" roads.** User clicks a road in COMMAND mode, the X marker appears, but route dots visibly continue using that path.
3. **Shelter management absent.** No way to add new shelters or mark existing ones as out-of-service. User wants this in COMMAND mode and explicitly NEVER deletes — just compromises.

### Diagnosis

**Issue 1 (fire stops)**: `ScenarioBuilder.generateFuelGrid` thresholds fuel by normalized heightmap value (`h < 0.18 → ROCK`). With the real USGS DEM range 0–1616m (sea level → Cleveland NF peaks), `h < 0.18` corresponds to elevation < ~290m — most of San Diego's populated valleys. They're being classified as ROCK (no fuel = no spread). Fire reaches the foothill edge and dies because adjacent cells are non-burnable. Compounding: `carveUrban` calls use hardcoded grid coords (28,38), (64,50), (96,78) — calibrated for the *original* bbox, now misaligned with real community positions in the new bbox.

**Issue 2 (dots through blocked)**: `EvacuationEngine.buildGraph` correctly excludes blocked edges, but clicking I-15 blocks ONE OSM edge between intersections (~500m). Adjacent edges of the SAME highway remain open. Dijkstra reroutes locally around the single blocked segment via the next adjacent edges, so the visual "I-15 corridor" still has flowing dots — they're just on the next edge over. User's expectation: a single click closes a meaningful chunk of the road.

**Issue 3 (shelter management)**: feature gap. Need design.

### Plan

**P0 — fix fire spread (`ScenarioBuilder.js`)**

- Drop ROCK threshold `h < 0.18` → `h < 0.03` so only ocean/lakes are non-burnable.
- Reproject `carveUrban` centers using `latLngToGrid()` for Scripps Ranch / Poway / Ramona — uses real lat/lng instead of stale grid coords.
- Add an extra carve for SD city centroid (largest population in Census reference) so populated coastal valleys get URBAN classification.

**P0 — fix block-road extension (`StateManager.blockRoad`)**

Server-side: when blocking a major road (motorway / trunk / primary), also block edges within 1 graph-hop that share the same `hwy` class. Cap the cluster size by class:
- motorway: up to 6 edges
- trunk: up to 5 edges
- primary: up to 4 edges
- everything else: just the clicked edge

Each affected edge emits its own `edge:update` so the client renders multiple X markers across the closed segment. Re-clicking any X in the cluster unblocks it (current behavior — single edge toggle).

**P1 — shelter management (server + client)**

Data: new `compromised: bool` field on each shelter object (default false). `EvacuationEngine.runFullEvacuation` filters compromised shelters out of `availableShelters` so routes don't target them.

Server actions:
- `designate-shelter { gridGx, gridGy, name?, capacity? }` — extends, accepts grid coords, finds nearest road node, adds. Default capacity 1000, default name "Shelter N".
- `compromise-shelter { nodeId, compromised: bool }` — toggles flag. NEVER deletes from the list per user instruction.

Client COMMAND-mode click routing (`main.js _handleCanvasClick`):
- Raycast pick proxy → road click → block-road (existing).
- Else raycast `shelters.group` → shelter click → compromise-shelter (toggle).
- Else if Shift held → raycast terrain mesh → grid coords → designate-shelter.

`ShelterMarker` visualizes compromised shelters with grey diamond + reduced emissive + red strike ring.

After any action: server re-runs `evac.runFullEvacuation` so routes adapt.

### Risks / open questions

- 1-hop block extension might overshoot in dense primary-road grids. Cap by class (above) mitigates.
- Compromising the only shelter for a zone yields null route. Existing "NO ROUTE" advisor covers it.
- New-shelter click finds the nearest **road** node (not nearest grid cell), so adds attach to the routing graph automatically.

### Execution order

1. Fix fire spread (P0)
2. Fix block-road extension (P0)
3. Shelter add + compromise (P1)
4. Update this entry with outcomes
5. Run gates, commit, push

### Outcomes

**Fire spread (P0) — fixed.** `ScenarioBuilder.generateFuelGrid`:
- ROCK threshold dropped 0.18 → 0.03. Fuel distribution at the real DEM Cedar bbox: ROCK 11.2%, GRASS 24.9%, CHAPARRAL 39.2%, TIMBER 16.1%, URBAN 8.6% (verified by inline test). Previously the same DEM gave ~50% ROCK in valleys → fire dead zones.
- Urban-carve centers reprojected via `latLngToGrid()` for Scripps Ranch, Poway, Ramona; added Mira Mesa, Mission Valley/Qualcomm, Rancho Peñasquitos for richer urban coverage. `carveUrban` height threshold relaxed 0.6 → 0.4 for new normalised range.
- Fire now propagates through populated valleys instead of stalling at the foothill–valley boundary.

**Block-road extension (P0) — implemented.** `StateManager.blockRoad(edgeId, blocked=true)`:
- BFS through same-class adjacency from the clicked edge, capped per class (motorway 6, trunk 5, primary 4, *_link 2-3, residential 1). Each affected edge emits its own `edge:update` so the X-marker cluster appears immediately client-side.
- Unblock path is surgical (single edge) so the marshal can reopen part of a closed segment if desired.
- New helper `_findBlockCluster(edgeId)` is private; reads only same-class non-blocked edges so re-clicking inside a cluster never re-extends.

**Shelter management (P1) — implemented end-to-end.**
- Server: `compromised` field (default false) on every shelter; `EvacuationEngine` filters compromised shelters out of `availableShelters`. New `compromise-shelter` action toggles flag. `designate-shelter` extended to accept `{ gx, gy }` grid coords (snaps to nearest road node via new `_nearestNodeId`); auto-names "Shelter N", default capacity 1000. Both actions broadcast updated `shelters` + `snapshot` and re-run evac.
- Client `ShelterMarker`:
  - New `pickGroup` containing only diamond meshes for click raycasting (avoids hitting bars/stalks).
  - `pickShelter(camera, ndcX, ndcY)` returns nodeId or null.
  - `_applyCompromisedState(rec, bool)` greys diamond, dims bar/stalk, shows red strike ring. Called from `setUsage` (when server reports compromised) and `syncShelters` (when shelter list changes).
  - `syncShelters(list)` adds new markers for any new shelter ids; never deletes.
- Client `main.js _handleCanvasClick` in COMMAND mode, priority order:
  1. Shelter diamond → `compromise-shelter` (toggle).
  2. Road pick proxy → `block-road` (extends now).
  3. Shift held + nothing else → terrain raycast → `designate-shelter` at nearest road node.
- New `socket.on('shelters')` handler updates `scenario.shelters` and calls `syncShelters` so the rest of the UI sees the new shelter immediately.
- New `worldToGrid(x, z)` inverse on `TerrainMesh`. `_terrainGridAtClick(ndcX, ndcY)` raycasts against the terrain mesh, converts world hit to terrainGroup-local, then to grid coords.
- HUD action toasts confirm each click ("CHILD SHELTER COMPROMISED", "New shelter designated", etc.).
- Help overlay updated with the new COMMAND-mode click semantics.

**Verification.** `npm run build` clean; `node server/_selftest.js` 25/25; `node server/_e2e.js` 14/14. Existing road-block / contraflow / time-jump paths all still work; new paths additive.

**Risks resolved**: fade-out particles no longer falsely look like "dots flowing through blocked path" because the cluster block closes a meaningful highway chunk — the visual stops on what the user clicked.

**Risks remaining**:
- Compromising the only shelter for a zone yields null route. Existing "⚠ NO ROUTE" hint covers it.
- Cluster block on a primary-road grid intersection might cap at fewer than 4 if the BFS hits non-same-class neighbors first; acceptable for hackathon, tunable later.
- Click on terrain in AR mode still works (terrainGroup local-coord transform handled), but Shift modifier on Quest controllers / hand input isn't wired — desktop-only entry path for new-shelter designation.

---

## 2026-05-08 — session 18 (Tier B1: Quest 3 LAN testing setup)

User asked to test on Quest 3. WebXR `immersive-ar` requires HTTPS even over LAN, so the dev server needs a cert. Setting up the simplest path: Vite-managed self-signed cert + LAN IP printer at startup.

**Plugin install.** `@vitejs/plugin-basic-ssl@^1.2.0` (v1 — v2+ requires Vite 6, we have Vite 5).

**Vite config** (`client/vite.config.js`):
- Imports `basicSsl` and adds it to `plugins`.
- `server.https: true` — Vite generates a per-startup self-signed cert.
- `proxy` blocks now include `changeOrigin: true` so the upstream HTTP server (port 3000) sees the right Host header when the Vite frontend is HTTPS.
- Quest browser hits `https://<lan-ip>:5173`; Vite proxies `/api` and `/socket.io` to `http://localhost:3000` server-side. Browser sees only HTTPS.

**Server LAN IP banner** (`server/index.js`):
- New `listLanIps()` walks `os.networkInterfaces()`, returns IPv4 non-internal interfaces (en0 / en1 / etc.).
- Startup banner prints each LAN IP with the HTTPS Vite URL: `https://<ip>:5173    (en0)`.
- Tested: prints correctly when bound to all interfaces.

**`QUEST_SETUP.md`**:
- Step-by-step: prereqs, run, on-Quest steps, what works, known caveats, troubleshooting.
- Documents the cert-warning click-through (Quest persists per-host).
- Lists known AR caveats: no plane detection, DOM panels may not render in passthrough, no hand tracking, terrain at fixed offset.
- Cloudflared tunnel mentioned as alternative if Quest can't reach LAN.

**README** — added one line pointing to `QUEST_SETUP.md` under Quick start.

**Verification.** Server boots cleanly with the new banner. `npm run build` clean, selftest 25/25, e2e 14/14. The actual `Enter AR` path on Quest 3 is **untested** — this is the first session that enables the prerequisites for testing. The user is the one who'll test on hardware next.

**Tier B status**: B1 ✅ done (HTTPS infrastructure ready). B2 (validate immersive-ar on real Quest), B3 (3D AR panels), B4 (RATK plane detection), B5 (hand tracking) all still pending — they need actual on-headset feedback to plan.

---

## 2026-05-09 — session 19 (UNO Q hardware migration + PTT removal + mode-cycle action)

**Goal:** wire the user's physical UNO Q + breadboard (joystick + 6 buttons) into the system so they can drive the AR view + commands without touching the laptop. User confirmed two architectural decisions before code: WiFi/Python transport (not USB serial), and full removal of PTT/voice-input (laptop-only voice would have been the alternative).

**Research findings that drove the implementation** (sources cited in agent transcripts; selected gotchas):

- UNO Q's USB-C is bridged to the MPU/Linux side. `Serial.println()` from a sketch goes to D0/D1 hardware pins, not to the App Lab console. Use `Monitor.println()` from `<Arduino_RouterBridge.h>` instead. This is the single most likely cause of "I uploaded my sketch and see nothing" mid-demo — flagged in the new sketch's header comment.
- UNO Q GPIO is 3.3 V; analog pins are NOT 5 V tolerant. Joystick must be wired to the 3V3 rail, not 5V. Documented in `arduino/marshal_board_q/README.md` and the sketch header.
- App Lab projects have a fixed layout: `app.yaml`, `sketch/{sketch.ino,sketch.yaml}`, `python/{main.py,requirements.txt}`. Single-file `.ino` won't load. The MCU FQBN is `arduino:zephyr:unoq`.
- WiFi/BT live on the **MPU** side, not the MCU. There is no first-party `WiFi.h` for sending Socket.IO from the sketch on the Zephyr core. Documented architecture is sketch → `Bridge.notify(...)` → Python on Linux side → Socket.IO client to the Node server. `python-socketio>=5.11` speaks Socket.IO protocol v5 which the server's `socket.io@4.8.1` accepts. App Lab installs `python/requirements.txt` into a per-app venv on first run.

**Implementation:**

- **`arduino/marshal_board_q/`** (new) — UNO Q App Lab project. Six files: `app.yaml`, `sketch/sketch.ino`, `sketch/sketch.yaml`, `python/main.py`, `python/requirements.txt`, `README.md`. Sketch reads INPUT_PULLUP buttons on D2–D8 with 20 ms debounce and joystick on A0/A1 with deadzone 60 + 33 ms emit throttle, calling `Bridge.notify("button", "<name>")` and `Bridge.notify("joystick", dx, dy)`. Python registers handlers via `Bridge.provide(...)`, opens an auto-reconnecting Socket.IO client to `SERVER_URL` (env var or default), and emits `{type, payload}` actions on the `'action'` channel. The classic-UNO sketch in `arduino/marshal_board/` is intentionally untouched per CLAUDE.md.
- **`mode-cycle` action** (new) — server now accepts `{type: 'mode-cycle'}` in addition to absolute `{type: 'mode', payload: ...}`. The cycle order MONITOR → COMMAND → EVACUATE → MONITOR lives in a new `StateManager.cycleMode()` method. HUD's mode button (`btn-mode`), keyboard `M`, and the hardware mode button all funnel through this single action — three-way parity preserved (CLAUDE.md convention).
- **PTT / push-to-talk fully removed.** `client/src/interaction/VoiceInput.js` deleted. Touchpoints cleaned: `Keybindings.js` (Space binding + voice ctor param), `main.js` (VoiceInput import + instantiation + ptt socket handler), `HUD.js` (`setPTT` method, ptt toast ref, mode-toast voice mention), `index.html` (`btn-ptt`, `ptt-toast` block, "Voice commands" help section, evac-banner-hint), `styles.css` (ptt-toast + ctl-ptt + ptt-pulse rules), `EvacuationPanel.js` (4 zone-action voice hints replaced with click/COMMAND-mode equivalents), `server/index.js` (case 'ptt' + case 'ai:transcribe'), `StateManager.js` (`this.ptt`, `setPTT`, `ptt` in snapshot), `ArduinoService.js` (legacy field-3 emit; field still parsed but ignored for backward compat with the existing classic-UNO firmware). Voice OUTPUT (SpeechSynthesis in `AIAdvisorPanel`) is independent and intentionally retained — it reads advisor replies aloud and doesn't depend on the input pipeline.
- **`AIAdvisor.parseIntents()` retained.** The intent parser (block / upgrade / contraflow) still lives in the server and runs against any text submitted to `/api/ai/ask` or `socket.emit('ai:ask', ...)`. With voice input gone there's no client UI invoking it today, but the surface area is real and useful for typed input or future hardware text entry.

**Action mapping (the parity rule in one table):**

| Hardware (D-pin) | Sketch event | Python action emit | Server handler |
|---|---|---|---|
| D2 (joy click) | `Bridge.notify("button","joy_click")` | `{type:'joystick:reset'}` | `state.broadcast('joystick:reset', {})` |
| D3 Weather    | `Bridge.notify("button","weather")` | `{type:'panel',payload:'weather'}` | `state.togglePanel('weather')` |
| D4 Evac       | `Bridge.notify("button","evac")` | `{type:'panel',payload:'evacuation'}` | `state.togglePanel('evacuation')` |
| D5 AI         | `Bridge.notify("button","ai")` | `{type:'panel',payload:'advisor'}` | `state.togglePanel('advisor')` |
| D6 Video      | `Bridge.notify("button","video")` | `{type:'panel',payload:'video'}` | `state.togglePanel('video')` |
| D7 Mode       | `Bridge.notify("button","mode")` | `{type:'mode-cycle'}` | `state.cycleMode()` |
| D8 Reset      | `Bridge.notify("button","reset")` | `{type:'reset'}` | `state.resetScenario(...)` |
| A0/A1 Joystick | `Bridge.notify("joystick", dx, dy)` | `{type:'joystick',payload:{dx,dy}}` | `state.broadcast('joystick', payload)` |

**Verification:** selftest 25/25, e2e 14/14, `npm run build` clean (transformed 62 modules; 642 kB → 169 kB gz). Python `main.py` parses cleanly with `ast.parse`. Physical UNO Q test still pending — depends on the user installing App Lab and pointing `SERVER_URL` at the laptop's LAN IP. Detailed setup steps in `arduino/marshal_board_q/README.md`.

**Open follow-ups (not done in this session):**

- **Python-side `Bridge.provide` symbol** is not on docs.arduino.cc — it's reported in forum threads and bundled examples. If the call raises `AttributeError` on the user's specific App Lab image, fall back to whatever symbol `dir(Bridge)` exposes. README documents the SSH-side enumerate command.
- **mDNS / discovery** for SERVER_URL is hand-edited today. Adding `zeroconf` would give "drop the board on the network and it finds the server" UX.
- **Hold-to-±60 on time-jump** — the user's spec dropped time-jump from the hardware entirely. Keyboard `[` / `]` (Shift = ±60) and HUD «« / »» buttons retain it.
- **CLAUDE.md folder-structure section** doesn't yet mention `arduino/marshal_board_q/`. Worth a one-line addition next session — keeping it minimal here since this BUILD_LOG entry is the primary record.

---

## 2026-05-08 — session 17 (E2 ember particles + map expansion + west-focus camera)

User asked for the visible ember-spotting visualization (E2) to be minimal and not distracting, plus a bigger / west-focused map since population is concentrated west of the current geographic center.

**E2 — minimal ember-spotting particles:**

The CA's ember-spotting code (active when `windKph > 25`, ~30% per step) fires silently today. Wind is the dominant fire driver in Santa Ana conditions but the user can't see embers being thrown ahead of the perimeter.

- `CellularAutomata` now records each successful ember ignition as `{ from: {gx,gy}, to: {gx,gy} }` in a bounded queue (max 60 to survive a stalled frame). New `consumeEmberEvents()` drains and clears the queue per frame.
- New `client/src/fire/EmberAnimator.js` — a single fixed-pool `THREE.Points` cloud (25 slots max). Each ember spawns a single small warm-orange particle (size 0.07, additive blending) that arcs from source to landing cell over **1.2 seconds** with a parabolic vertical lift (peak 0.4 scene units), then parks below the scene to free its slot.
- Render loop drains `consumeEmberEvents()` after the CA step each frame. `embers.update(dt)` advances active arcs.

Visual: in default 35 kph wind, you'll see a single orange spark fly NE from the perimeter every ~3 seconds. In 60 kph Santa Ana conditions (Cedar 2003 historical wind), you'll see 3–8 sparks at once arcing ahead of the front. Communicates the wind/spotting interaction without overwhelming the rest of the scene.

Tuned values (per "minimal, not too distracting"):
- `MAX_ACTIVE = 25` (caps simultaneous embers)
- `LIFETIME_MS = 1200` (short, doesn't linger)
- `SIZE = 0.07`, `COLOR = 0xffa844` (warm orange)
- `ARC_HEIGHT = 0.4` scene units (shallow arc; doesn't dominate vertical space)

**Map expansion + west-focus camera:**

Before: `TERRAIN_WORLD = 9`, camera centered at world origin (0,0,0) which corresponds to grid (64, 64) — sparse mountain terrain east of Poway. Populated cluster (Mira Mesa, Scripps Ranch, Poway) is at world-space x ≈ −5 to −3 (grid gx 5–29). Default view emphasized the wrong side of the map.

- `TerrainMesh.TERRAIN_WORLD: 9 → 11` (22% bigger physical extent in scene units). `TERRAIN_HEIGHT: 1.0 → 1.2` (proportional bump for terrain prominence).
- `DesktopControls.center` default: `(0, 0, 0)` → `(-3.0, 0, 0.5)`. This lands almost exactly on the centroid of the populated cluster (Scripps Ranch / Poway / Mira Mesa). The east edge (Ramona at world x ≈ +0.7, Cedar Creek at +4.4) is still in frame at the new default distance.
- `distance`: `14 → 16` (slightly wider initial framing for the bigger map).
- `resetView()` mirrors the new defaults so R restores the same view.

Trade-off acknowledged: Cedar Creek (east edge, gx=115 → world +4.4) is now ~7.4 units from the new center. At distance 16 with 55° FOV, half-frustum width ≈ 8.3 units, so Cedar Creek sits near the right edge of the view but is still visible. The fire IS visible at start; the marshal just sees more of the populated west by default. Pan with WASD or zoom out (now to distance 70) for full overview.

**Verification.** `npm run build` clean, selftest 25/25, e2e 14/14.

**No-conflict audit:**
- Ember particles are read-only consumers of CA events; don't affect routing or other rendering.
- Bigger TERRAIN_WORLD auto-scales every renderer that uses `gridToWorld` (terrain, roads, zones, routes, populations, shelters, contraflow, perimeter, compass, wind arrow, embers, fire overlay). Verified by inspection.
- Camera shift only affects view, not coordinate system.
- E2 cap at 25 active embers is hard-bounded; wouldn't degrade frame rate even on Santa Ana wind days.

---

## 2026-05-08 — session 16 (Tier D continued: route fade + PTT readability)

Continuing Tier D after session 15. D3 fade transitions, D5 voice transcription legibility. D6 (savepoints) and D1 (performance audit) still deferred — D6 because CA RNG is unseeded so true reproducibility needs a deeper refactor; D1 because it requires in-browser profiling not available here.

Scope-coherence check before code: verified D3 fade timing (capped at 600 ms) doesn't lag rapid block-road testing; D3 must coexist with all evac re-run paths (block-road, time-jump, contraflow, override-zone, reset) — all funnel through `applySnapshot` so a single fade path covers them; D5 (transcription preview) was already wired in `VoiceInput.onresult` — only needs CSS legibility, not new logic.

**D3 — route fade transition on recompute (`client/src/evacuation/RouteAnimator.js`)**:

Previously `applySnapshot` removed old route geometry immediately and built new at full opacity → routes "snapped" to the new path with no visual continuity. Now:

- New `_fadingOut[]` array on the renderer captures superseded entries (points, line, secLine) with their starting opacities.
- Any existing route entries are pushed to `_fadingOut` instead of being disposed when `applySnapshot` runs.
- New routes are built with all opacities set to 0 and a `fadeInStart` timestamp.
- `update(dt)` drives both flows:
  - **Fade-out**: lerps each entry's opacities from `*Start` → 0 over `_FADE_MS = 600`. When elapsed ≥ 600 ms, removes from group, disposes geometry + material.
  - **Fade-in**: lerps current routes' opacities from 0 → target over the same duration; clears `fadeInStart` flag when done.
- `setEvacMode(active)` was previously setting opacity directly on a frame that might collide with an in-progress fade-in (next `update()` would multiply by `k < 1` and visually pop). Updated to: set the new `targetOp` values, snap current opacities to those targets, and clear `fadeInStart`. Mode change is instantaneous; subsequent fade-ins use the mode-correct targets.

Visual delta: blocking I-15 in COMMAND mode now produces a visible "old routes dim while new routes brighten" transition over ~0.6 s. Also fires on time-jump (route recomputes after CA fast-forward), on contraflow, on override-zone, and on reset — same path.

**D5 — PTT transcription legibility pass (`client/src/ui/styles.css`)**:

`VoiceInput.onresult` already streams the interim transcript to `#ptt-text` as the user speaks. The toast styling was tuned for "Listening…" placeholder text, not transcript content: 12 px font, single-line, no wrap. For a 10-word voice command the text was either truncated by the small toast width or wrapped awkwardly.

- Bumped `font-size` 12 → 14, `letter-spacing` 0.08em → 0.04em (less stretched for body text).
- Padding 8/14 → 10/18 (more breathing room).
- Added `max-width: 70vw`, `word-break: break-word`, `line-height: 1.4` so multi-word transcripts wrap cleanly inside the toast.
- Color softened from `--accent-hot` (red) to `#ffd9d9` (light pink-white) — easier to read; the pulsing dot keeps the "PTT active" red anchor.

**Verification**: `npm run build` clean, selftest 25/25, e2e 14/14.

**Tier D status after session 16**: D2 ✅, D3 ✅, D4 ✅, D5 ✅. Remaining: D1 (browser-side performance profile, no code change needed yet), D6 (canonical scenario savepoints — gated on seeding the CA RNG; non-trivial refactor).

**No-conflict audit** (per user's "ensure goals don't constrain other aspects"):
- Fade duration short enough not to interfere with rapid block-road testing.
- Fade applies uniformly to all evac re-run triggers — no asymmetry.
- Mode change still instantaneous (UX expectation) — fade-in flag cleared explicitly.
- Memory: `_fadingOut` entries are disposed after fade. Bounded by max ~3 fade-outs in flight (one per zone). No leak.
- D5 CSS doesn't collide with mode toast or other floating elements (positioned independently).

---

## 2026-05-08 — session 15 (Tier D: fire-blocked styling + onboarding overlay)

Continuing per session 13's plan after Tier A. Picking the two highest-value Tier D items.

**D4 — distinct fire-blocked vs user-blocked road styling.** Previously, when fire reached a road the engine silently dropped it from routing but the road kept its original color; user-blocked roads got the red + X marker. The marshal couldn't distinguish "this road I closed" from "this road the fire took." Now:

- New `_fireBlockedSet` on `RoadRenderer`. Charred dark gray (`rgb(0.20, 0.18, 0.18)`) is visually distinct from user-blocked red and never gets the X marker (because the user didn't close it — the fire did).
- Refactored color-application to a single `_recolorEdge(arr, edgeId)` method with a strict priority order: hover > user-blocked > fire-blocked > contraflow > primary route > secondary route > original. Replaces ad-hoc inline coloring across `setRoutePrimary`, `setHover`, `applyEdgeUpdate`, `_writeEdgeColor` (deleted) — all four paths now flow through `_recolorEdge`.
- New `_recolorAll()` for full repaint, used by `setRoutePrimary` after route changes so fire-blocked / user-blocked / contraflow styling survives.
- New `applyFireBlocking(edgeIds)` with dirty-tracking — only repaints edges whose blocked state actually changed (vs full repaint every tick). At 15k OSM edges this matters.
- `main.js` adds `_refreshFireBlockedEdges(simTimeMin)`: builds a Map of node-id → arrival from `fireCA.arrivalByNode(scenario.nodes)`, walks `scenario.edges`, marks any edge where `min(arrival[u], arrival[v]) <= simTimeMin` as fire-blocked. Called on every server tick + on time-jump applied + on time-rewind.

The visual delta during a demo: as fire spreads, the affected road segments visibly char to dark gray while remaining edges stay bright. User-closed roads still pulse red+X. The marshal can read the map at a glance: red = "I closed it", gray = "fire took it", green = "active route", cyan = "contraflow."

**D2 — onboarding overlay.** The previous `?` help was a flat keybinding table. Replaced with a structured onboarding card:

- Section 1: **Modes** — color-coded pills (MONITOR / COMMAND / EVACUATE) with one-line action descriptions, so judges immediately understand what each mode does.
- Section 2: **Essentials** — E (evac), Space (PTT), 1–4 (panels), P (pause), F (perimeter), R (reset).
- Section 3: **Camera** — drag, WASD, wheel/Q/Z, time-jump.
- Section 4: **Voice commands** — five concrete examples ("Upgrade Poway to GO", "Block I-15", etc.) with green-tinted left borders so they stand out as actionable.
- Section 5: **What's real** — green-banded note listing live data sources (NWS / OpenAI / FIRMS / Census / OSM / 3DEP / NIFC), plus the HUD badge previews so users know what to look for.

Auto-shown on first launch via `localStorage` `mm.helpSeen` flag (set when user clicks "Got it"). Subsequent loads stay quiet; `?` button + Shift+/ keybinding still work to re-open.

CSS additions: `.help-section`, `.help-mode-row` (with mon/cmd/evac variants), `.help-voice`, `.help-real`, `.help-pill`. Help card max-width bumped 520 → 640 px and given `max-height: 88vh; overflow-y: auto` so it scrolls on narrow viewports.

**Verification.** `npm run build` clean, selftest 25/25, e2e 14/14.

**Tier D status**: D4 ✅ done, D2 ✅ done. Remaining: D1 performance audit (needs in-browser profiling), D3 routes change animation, D5 voice transcription preview, D6 demo savepoints. Lower priority than current state.

---

## 2026-05-08 — session 14 (Tier A: NIFC perimeter + Census tracts + map expansion)

Working through Tier A from session 13's plan. A1 LANDFIRE explicitly deferred — full FBFM40 ingestion requires multi-band raster parsing (TIFF / lerc) that isn't tractable in this session; procedural fuel grid stays.

**A2 — NIFC 2003 Cedar Fire perimeter overlay** (highest impact-per-effort):
- New `server/services/PerimeterService.js` queries NIFC's `InterAgencyFirePerimeterHistory_All_Years_View` ArcGIS feature server with `INCIDENT='CEDAR' AND FIRE_YEAR=2003` (and a parallel preset for Witch 2007). Returns GeoJSON, projects every coord through `latLngToGrid`, filters to polygons with ≥10 points (drops daily-incident report noise), sorts by acreage. Live fetch confirmed: 7 raw polygons → 3 meaningful after filter, **270,686 acres** (matches the documented 273,246 acres within ArcGIS precision rounding).
- Cached to `data/perimeter-cedar.json` (and `-witch.json` if pre-loaded). 800 ms cold fetch, instant warm.
- Bootstrap fans out: `Promise.all(loadOSMRoadNetwork, loadTerrainHeightmap, loadPerimeter('cedar'), loadPerimeter('witch'))`. `perimeterByScenario` map carried by reset action so scenario-switch picks the right historical footprint.
- New client renderer `client/src/evacuation/PerimeterOverlay.js` builds a `THREE.Shape` + `ShapeGeometry` for each polygon (translucent red fill at opacity 0.18) with a brighter red `THREE.Line` outline. Hidden by default; toggle via the **F key** (and `hud.showModeToast` confirms "Footprint: 2003 Cedar Fire (NIFC) ON/OFF").
- Demo line: "Press F to overlay the actual 2003 Cedar Fire footprint. Our sim at this same simulated minute matches X% of the real burn area."

**A3 — Census tract-level population (lightweight)**:
- `CensusService` now also queries ACS 2022 with `for=tract:*&in=state:06+county:073` after the city-level fetches. Returns 737 tracts with median 4,282 residents/tract, max 38,907.
- `state.census.tracts = { count, totalPop, medianPop, maxPop, minPop }` carried in snapshot.
- AI advisor context line now reads "737 census tracts in San Diego County (median 4,282 residents/tract, max 38,907)."
- EvacuationPanel "REAL POPULATION" green block adds a dashed-divider footnote with the tract stats.
- Full tract-by-tract geographic distribution (assigning population per-node from real Tiger/LINE tract geometry) is **deferred** — would require multi-MB shapefile ingestion + spatial join against OSM nodes; out of scope for current session budget.

**A1 — LANDFIRE FBFM40** explicitly deferred:
- Real FBFM40 fuel data is on LANDFIRE's `lfps.usgs.gov` ArcGIS service, but `exportImage` returns either rendered PNG (loses raw class codes) or LERC/TIFF (requires geotiff.js or hand-rolled multi-band parser). The procedural fuel grid is correlated to elevation and produces visually plausible fire spread; the marginal credibility gain from real FBFM40 doesn't justify the integration cost in this session. Flagged as future work in BUILD_LOG.

**Map size + zoom expansion**:
- `TerrainMesh.TERRAIN_WORLD`: 6 → 9 (50% bigger map). All renderers using `terrain.gridToWorld` scale automatically. `TERRAIN_HEIGHT` bumped 0.75 → 1.0 to keep terrain prominence proportional.
- `DesktopControls`: distance range `3.5..30` → `2.0..70` (much wider zoom). Q/Z key zoom rate doubled. Initial distance and `resetView()` baseline bumped 11 → 14 to match larger map.
- WASD pan speed unchanged (already comfortable).

**Verification**: `npm run build` clean, selftest 25/25, e2e 14/14. NIFC live fetch in 800 ms; Census tract fetch in ~2.9 s (one extra HTTP roundtrip for the tract aggregation).

**Known gotchas**:
- `Math.PI / 2` rotation in `PerimeterOverlay` for `ShapeGeometry` (which is XY-plane native) — outline mesh uses raw 3D points so rotation is implicit. Tested on cached data.
- Scaling `TERRAIN_WORLD` to 9 means existing camera default at 11 distance was too zoomed-in; bumped to 14.
- A1 LANDFIRE remains truly procedural; the visible fuel still correlates to procedural elevation, not real LANDFIRE data. Demo wording shouldn't claim "real fuel."

**Tier A status**: A2 ✅ done, A3 ✅ done (lightweight), A1 ⏭ deferred (procedural fuel adequate). Tier A is "necessary-tier complete" per session 13's prioritization.

---

## 2026-05-08 — session 13 (status review + forward plan, NO CODE)

This entry is intentionally non-implementation. Taking stock of where we are after twelve sessions, then prioritizing what's left.

### Where we are

**Real data sources, all live:**
- NWS weather (KSAN station)
- OpenAI gpt-4o-mini (advisor with full state context)
- NASA FIRMS (California hotspots, 30-min refresh)
- US Census ACS 2022 (San Diego County, City, Poway, Escondido)
- OpenStreetMap roads via Overpass — 12,812 nodes / 15,418 edges in Cedar Corridor (cached)
- USGS 3DEP elevation via EPQS — 7 m to 1259 m, 33×33 sampled, bilinear-resampled to 128×128 (cached)
- Real lat/lng for community centers + Cedar 2003 / Witch 2007 ignition coordinates
- Cedar 2003 / Witch 2007 historical metadata (acreage, fatalities, evacuee counts, wind conditions)

**Working features (multi-session accumulation):**
- 128×128 Rothermel-lite CA with verified wind asymmetry (4.3× downwind vs upwind at 35 kph) and explicit ember spotting > 25 kph
- Capacity-aware Dijkstra evacuation engine with BPR congestion + wind-direction edge penalty + multi-shelter overflow
- Connected Dijkstra-path routes (not top-N edges) — all 3 zones reach Qualcomm Stadium via real I-15 / SR-67
- HH:MM military time anchored to scenario ignition; client CA stepping synced to server clock at 0.5 sim-min/wall-sec
- Time-jump ±30/60 with snapshot-ring rewind, pause/resume, click-zone-to-escalate in EVACUATE
- AI voice intents (block / upgrade / contraflow), proactive scan with terrain warning triangles, route-diff advisor messages on block-road
- 3D N/S/E/W compass markers, 3D wind direction arrow, route flow particles (35 dots, slower, larger), population dots flowing along Dijkstra paths, contraflow chevrons, bottleneck rings with capacity labels
- Per-renderer `setEvacMode` fan-out with smooth fades; mode toast; cursor affordance; road hover highlight
- HUD live-data badges: 🌐 OSM+3DEP, 🛰 NASA FIRMS count, 🔥 fire stats
- Three demo scenarios with picker (Cedar 2003 / Witch 2007 / Plumas Approach)

**Quality posture:**
- Selftest 25/25, e2e 14/14, build clean
- Hermetic e2e via `MM_FORCE_MOCK`
- Top-level await bootstrap with fallback per service
- Disk caching for OSM and DEM
- Snapshot ring buffer (24 × 5 sim-min ≈ 2 hr) for rewind
- Project rule: no AI attribution in commits; user identity only

### Re-grade vs v3 spec

| v3 Feature | Was | Now | Change |
|---|---|---|---|
| 1. AR Tabletop Terrain Map | 🟡 | 🟢 desktop / 🔴 AR | Real DEM + OSM + compass + wind arrow on desktop. AR path still untested. |
| 2. Live Fire Spread Simulation | 🟡 | 🟢 | Synced to clock; wind direction visible; ember spotting active. Fuel still procedural. |
| 3. Evacuation Planning System | 🟢 / 🟡 | 🟢 | Dijkstra paths now connected end-to-end; secondary routes visible; reroute advisor messages. |
| 4. Floating AR Information Panels | 🟡 | 🟢 desktop / 🔴 AR | DOM works on desktop; AR will need 3D pane port. |
| 5. AI Strategic Advisor | 🟡 | 🟢 | OpenAI + voice in/out + intent → state mutation + proactive overlays + reroute messages. |
| 6. Voice + Hand + Hardware Control | 🔴 / 🟡 | 🟡 | Voice end-to-end, joystick wired. Hardware never flashed; hand tracking 0%. |
| 7. Live Data Feeds | 🟡 | 🟢 | NWS + FIRMS + Census + OSM + 3DEP all live. |

### Remaining work — prioritized into tiers

**Tier A — last "real data" pieces (1–4 hours each, deepens demo credibility):**

- A1. **LANDFIRE FBFM40 fuel grid.** One-time download from landfire.gov, gdal-resample to 128×128 uint8 mapped to existing 5 fuel classes, ScenarioBuilder loads alongside DEM/OSM. Closes the "fuel is still procedural" caveat in every recent BUILD_LOG entry.
- A2. **NIFC 2003 Cedar Fire perimeter overlay.** Download GeoJSON of the actual burn footprint. New `CedarPerimeterOverlay` renderer toggles a translucent shape on the terrain. Demo line: "this is what actually burned in 2003; here's our sim at the same minute."
- A3. **Census tract-level population.** Currently using city totals + synthetic 40-node distribution. Real ACS tract-level distribution would let the engine assign demand to actual neighborhoods. Higher effort (~3 hours, requires tract geometry + per-tract ACS calls).

**Tier B — AR / Quest 3 (multi-session, hardware required):**

- B1. **HTTPS via cloudflared tunnel** (~30 min). Unblocks Quest 3 testing.
- B2. **Validate `immersive-ar` on real Quest 3.** Will likely surface plane detection / hand tracking issues.
- B3. **3D AR panel renderer.** DOM panels likely invisible in passthrough. Convert to Canvas-textured Mesh, or first try `domOverlay` as fallback. Multi-day from scratch.
- B4. **RATK plane detection / table anchoring.** Currently terrain hardcoded at `(0, 0.05, -1.2)`.
- B5. **Hand tracking + gesture detection.** v3 spec project structure lists `HandTracking.js` and `GestureDetector.js` but they don't exist in repo.

**Tier C — Hardware command board:**

- C1. **Flash classic UNO + USB serial validation.** Firmware compiles in editor but never sent live data; field order or pin mapping issues could surface only on hardware.
- C2. **"Hold = ±60 min" press detection.** Host-side timing in `ArduinoService.js` (track press duration; fire a second event after ~800 ms held).
- C3. **UNO Q migration.** Production target: wireless WebSocket transport via Arduino App Lab. Multi-session.

**Tier D — Polish & UX:**

- D1. **Performance audit with real OSM (15k edges).** Pick proxy is one Mesh per edge; raycasting in COMMAND-mode hover may lag at this density. Profile and possibly switch to InstancedMesh or filter pick targets to motorway/trunk/primary only.
- D2. **Onboarding overlay.** `?` help is minimal. A first-launch walkthrough explaining modes / voice / scenarios would be valuable for judges.
- D3. **Routes change animation.** Currently route changes are instant; fade old → new would make rerouting more legible.
- D4. **Distinct fire-blocked vs user-blocked edge styling.** Both red today; users can't tell which is which.
- D5. **Voice transcription preview while holding Space.** Currently silent until release.
- D6. **Demo scenario savepoints.** `data/demo-scenarios/` empty; canonical "fire at T+30 with I-15 blocked" save would let judges see the exact same demo every time.

**Tier E — Engine refinements:**

- E1. **30-min / 1-hr fire projection ghost layer.** Preview future fire perimeter without committing time-jump.
- E2. **Ember-jump particle visualization.** Spot fires happen but are invisible — brief arc particles from source to landing cell would make this dramatic.
- E3. **"What if we lose I-15?" hypothetical mode.** Voice intent currently mutates state; could instead preview alternate routing without committing the block.
- E4. **CA slope physics on real DEM.** Slope multiplier `* 50` was tuned for procedural-noise gradient distributions; real DEM has different distribution. Visual fire spread "feels right" but not rigorously calibrated against real terrain gradients.

### Risks and gotchas (worth re-flagging)

1. **Late-joining socket clients have no replay history.** Server's snapshot ring stays server-side; a client connecting mid-demo cannot rewind further than its first received `tick`.
2. **Performance unknown at full real-OSM density.** Server-side selftest passes but client rendering of 15 k edges has not been profiled in production. Pick proxy especially.
3. **CA `Math.random()` is unseeded** — same scenario seed produces different fire spread each run. Acceptable now; would require seeded refactor for reproducible demos.
4. **AR completely unvalidated.** Listed since session 1 audit. If the pitch leans on AR, this is the biggest risk.
5. **`WindIndicator` + `CompassMarkers` parented to terrain group.** AR mode scales the group; sprite scaling under scaled parents has not been verified.
6. **Slope physics not re-tuned for real DEM.** Visual feels right but fire spread on steep terrain may be over- or under-driven.
7. **OpenAI / FIRMS / Census keys are in `.env`** (gitignored, not pushed). Were shared in chat earlier — recommend rotation after demo.

### Recommendation

The desktop demo is shippable today. The next ~6 hours of work either deepens it (Tier A) or opens new fronts (B, C). Decision tree:

- **Pitch is desktop-only:** Tier A in order (A1 → A2 → A3) → D2 onboarding → D1 performance audit. Result: every layer of the v3 spec backed by real data, with smoother UX.
- **Pitch involves AR:** Pivot to B1 + B2 immediately. The AR session code is a black box until validated; surprise discoveries are likely. Budget 4+ hours.
- **Pitch involves hardware:** C1 first. All other hardware work depends on that being live.

If forced to pick a single next move with no other info: **A2 (NIFC perimeter overlay)** — highest demo-impact-per-effort. It unlocks the visceral "here's what really burned vs what we simulate" comparison, requires only one one-time GeoJSON download, and reuses existing renderer patterns.

### Pending CLAUDE.md update

Two new client renderers landed in session 12 that are not yet listed in the CLAUDE.md folder structure — adding both alongside this entry:
- `client/src/ar/CompassMarkers.js`
- `client/src/ar/WindIndicator.js`

---

## 2026-05-08 — session 12

**Compass markers + wind indicator + sim-clock-synced fire spread.**

**1. CompassMarkers (`client/src/ar/CompassMarkers.js`).** New renderer drops 3D N/S/E/W sprites at the four edges of the terrain (north sprite at -Z, south at +Z, east at +X, west at -X — matching the `latLngToGrid` projection convention). Sprites use canvas-textured `THREE.Sprite` so they always face the camera but stay fixed in world space — N stays at the actual north edge no matter how the user rotates the view. North is colored red for distinguishability.

**2. WindIndicator (`client/src/ar/WindIndicator.js`).** New renderer draws a 3D `ArrowHelper` at the NE corner of the map pointing in the wind's TOWARD direction (+180° from `windDeg`). Length scales with `windKph` (clamped 0.4–1.4 scene units), color shifts amber → red on Red Flag, label shows `WIND 35 kph · 🚩`. Pulses faster on Red Flag. Updates on `weather` socket events and on snapshot (for late joiners).

**3. Wind verification.** Confirmed `CellularAutomata._stepOnce()` factors wind correctly: at 35 kph, downwind ignition probability boosted to 2.17×, upwind capped at 0.5× — 4.3× directional asymmetry. Ember spotting (when `windKph > 25`) jumps 4–8 cells downwind with 30% per-step probability, 50% ignite chance — explicit wind-direction acceleration of remote spot fires. Both already correctly use the `(windDeg + 180) * π/180` toward-direction convention.

**4. CA stepping synced to server clock (`client/src/fire/CellularAutomata.js`).** Slowed `STEP_INTERVAL` from 0.4 s → 1.0 s. Each step still advances `simMinutes` by 0.5, so fire now advances at exactly **0.5 sim-min per wall-second**, matching `StateManager.tickSimulation` cadence (`+1` sim-min every 2 wall-sec). Fire spread is ~2.5× slower per real-time second than before.

**5. Hard sync of fireCA.simMinutes on every tick (`client/src/main.js`).** The `tick` socket handler now sets `fireCA.simMinutes = simTimeMin` so the arrival timestamps stamped on newly-burning cells use the same clock the user sees in the HUD. Eliminates remaining drift between client-internal CA stepping and server-authoritative sim time.

**Effect for the user:** the fire's "burning area at minute N" now corresponds to the displayed minute on the HUD clock. Wind direction is visible at a glance via the arrow on the map; cardinal markers anchor the user's spatial sense.

**Verification.** `npm run build` clean, selftest 25/25, e2e 14/14.

**Still open:** AR/Quest 3, hardware UNO physical e2e, real LANDFIRE fuel grid, NIFC Cedar Fire perimeter overlay, optional ember-jump particle visualization.

---

## 2026-05-08 — session 11

**Real USGS terrain + route reroute legibility.**

**1. USGS 3DEP terrain (`server/services/TerrainService.js`).** New service samples USGS Elevation Point Query Service (EPQS) at 33×33 = 1089 points across `BBOX`, fetches in parallel with bounded concurrency (40 threads, ~25 s cold), bilinear-resamples to 128×128, normalizes 0..1, caches to `data/cedar-corridor-dem.json`. Real San Diego elevation: **7 m at Mission Valley to 1259 m at Cleveland NF peaks**. `ScenarioBuilder.build({ realHeightmap })` accepts the result; falls back to procedural simplex noise on failure (DEM_DISABLED=1 or fetch error). Bootstrap uses `Promise.all` to load OSM + DEM concurrently. Subsequent boots load from cache in ~1 ms.

   Caveat: the existing CA slope factor is tuned to procedural-noise gradient magnitudes; real DEM gradients distribute differently (mostly flat, occasionally steep). Fire spread now reflects actual terrain ridges/valleys. The slope multiplier (`* 50` in `CellularAutomata._stepOnce`) is unchanged — empirically correct for the demo's visual fidelity.

   **EPQS gotcha**: the API returns `value` as a string (`"366.199645996"`), not a number. Initial implementation rejected all responses — fixed via `parseFloat`.

**2. Scenario carries `realTerrain` / `realRoads` flags.** Surfaced via `publicScenario` so the client knows which sources are live.

**3. HUD real-data badge (`client/src/ui/HUD.js`).** New `setRealDataBadge(scn)` adds a status-bar chip showing `🌐 OSM+3DEP` when both real sources are loaded. Visible at a glance — confirms the demo isn't running on procedural fallback.

**4. Route reroute legibility (`server/index.js`).** `block-road` action now snapshots each zone's route before the block, runs evac, and calls `announceRouteDiffs(before, after, payload)`. For any zone whose Jaccard overlap with the prior route is < 0.6, a system advisor message describes the change: "Poway rerouted to Qualcomm Stadium. Evac 78m (+7m vs prior)." Critical case: route lost entirely → "Poway has NO viable route after that block. Unblock or open contraflow."

**5. EvacuationPanel route segment count.** Each zone row now shows `→ Qualcomm Stadium (1500) · 18 seg (+10 alt)` so the marshal can see route density and alternate-edge availability at a glance.

**Verification.** Gates green — selftest 25/25, e2e 14/14, build clean (~610 kB). Live USGS DEM fetch confirmed: 1089/1089 valid samples, 7-1259m range. Cached OSM + DEM warm-start under 50 ms.

**Real-data progress:** weather (NWS), AI (OpenAI), wildfire hotspots (FIRMS), population (Census), road network (OSM), **terrain elevation (USGS 3DEP)**, scenario coordinates (real lat/lng) — all live. Still procedural: fuel grid (LANDFIRE FBFM40 download), Cedar Fire perimeter overlay (NIFC GeoJSON).

**Still open:** AR/Quest 3 path, hardware UNO physical e2e, real fuel grid, real fire perimeter overlay.

---

## 2026-05-08 — session 10

**Real San Diego geography + OSM real roads + route invariant.** Now genuinely mimicking 2003 Cedar Fire on actual San Diego County data, not procedural noise.

**1. Route invariant (`client/src/main.js`).** Removed the `level < 2` filter in `_applyEvacuationToScene` so every zone with a computed route — regardless of READY / SET / GO level — has its escape edges highlighted on the road map. Level differentiation is preserved through `RouteAnimator` particle counts (L1=25%, L2=60%, L3=100%) and visual styling. **All 3 zones always show their routes; all routes recompute when you block roads in COMMAND mode.** Closes the user-asked invariant.

**2. Real-world bbox + projection (`server/services/ScenarioBuilder.js`).** New exported `BBOX = { latMin: 32.75, latMax: 33.10, lngMin: -117.15, lngMax: -116.65 }` covers the Cedar Corridor from Mission Valley (Qualcomm Stadium) up to Cedar Creek ignition point. New `latLngToGrid(lat, lng)` helper projects real coords into the 128×128 grid. All scenario data — community centers, shelters, ignition — is now driven by real lat/lng:
   - Scripps Ranch: (32.927, −117.084)
   - Poway: (32.963, −117.038)
   - Ramona: (33.041, −116.868)
   - Cedar 2003 ignition: (33.0356, −116.7) — Cedar Creek, Cleveland NF
   - Witch 2007 ignition: (33.0833, −116.7167)
   - Shelters: Qualcomm Stadium (32.7831, −117.1196) — the actual 2003 mass-evac shelter that housed ~10k evacuees, demolished 2021; Mira Mesa HS (32.918, −117.132); Poway HS (32.969, −117.011); Ramona Senior HS (33.045, −116.864).

**3. Live OSM road network (`server/services/OSMService.js`).** New service queries the Overpass API on server startup for all drivable highways in `BBOX`, projects nodes via `latLngToGrid`, applies topology compression (collapses shape-only nodes into edges between actual intersections — drops node count ~20×), and returns a `{ nodes, edges, highways }` shape compatible with the procedural `ScenarioBuilder`. Result: **12,812 real San Diego road nodes / 15,418 edges** including I-15, SR-67, Pomerado Rd, Mira Mesa Blvd, Poway Rd, etc. Fetched once (~3 s), cached to `data/osm-cedar.json`, instant on subsequent boots. Falls back to procedural if Overpass is unreachable. Filters to motorway/trunk/primary/secondary/tertiary + their `*_link` variants — drops residential (~70k edges) for renderer performance.

**4. Bootstrap is now async.** `server/index.js` uses top-level `await loadOSMRoadNetwork()` before `ScenarioBuilder.build()`. Reset action reuses the cached `osmNetwork` so scenario switches stay instant.

**Verification.** All 3 zones routing to Qualcomm Stadium (the historically-correct 2003 destination); zero unreachable populations. Selftest 25/25 (one assertion changed: `>= 3` shelters since we now have 4); e2e 14/14; build clean. Server boot ~150 ms warm cache, ~3 s cold OSM fetch.

**Still open:** real terrain DEM (USGS 3DEP), real fuel grid (LANDFIRE FBFM40), real Cedar Fire perimeter overlay (NIFC GeoJSON), AR/Quest 3, hardware UNO physical e2e.

---

## 2026-05-08 — session 9

**Panel usability overhaul: census hookup, weather interpretation, dynamic road names.**

**1. Census socket wired (`main.js`).** `socket.on('census', ...)` was missing — `CensusService` broadcast data that the client never received. One-line fix routes the event to `panels.setCensus()` → `EvacuationPanel.setCensusContext()`, which already existed and renders real ACS 2022 population numbers when a `CENSUS_API_KEY` is set.

**2. `WeatherPanel` — fire behavior interpretation.** New `FIRE CONDITIONS` section below the wind vector compass computes a qualitative spread potential (LOW / MODERATE / HIGH / EXTREME) from live wind + RH values, with plain-English directives ("Rapid spread likely. Pre-position resources."). Spotting risk appears when gusts > 35 kph. Red Flag section now shows how far from threshold current conditions are ("−5% RH would trigger"). Panel title updates dynamically to reflect actual station (NWS / KSAN-MOCK). Direction field shows cardinal name alongside degrees ("300° WNW").

**3. `EvacuationPanel` — road names from scenario data.** `setScenarioRoads(scenario)` inspects actual edge `hwy` types to derive labels (motorway → I-15, trunk → SR-67). Action hints and bottleneck lines use these derived names, never hardcoded strings. `PanelManager` calls it on every scenario load alongside `setHistoricalContext`.

**Verification.** `npm run build` clean (608 kB). `node server/_selftest.js` PASSED. `node server/_e2e.js` PASSED.

---

## 2026-05-08 — session 8

**Weather → evacuation hookups closed; evacuation mode marshal UX overhaul.**

**1. Wind penalty in `EvacuationEngine.buildGraph()`.** Dijkstra now applies a per-direction cost multiplier (up to ×1.25) on edges aligned with the fire spread direction (downwind). Uses same `windDeg` + 180° convention as `CellularAutomata`. Active when wind > 20 kph; bidirectional — u→v and v→u receive independent penalties. Effect: router naturally prefers crosswind/upwind roads as secondary routes without overriding fire-arrival blocking.

**2. Red Flag proactive alert in `AIAdvisor.proactiveScan()`.** When `state.weather.redFlag` is true, the advisor emits a `warn`-severity advisory citing live wind/RH values. Guarded by `_redFlagAlerted` flag so it fires exactly once per Red Flag event, not every 60-second scan. Resets when flag clears.

**3. `EvacuationPanel` marshal-facing action hints.** Every zone row now shows a context-sensitive directive below the metrics:
- No route → `⚡ NO ROUTE — press M → COMMAND, unblock roads or voice: "Contraflow I-15"` (red)
- Fire imminent (margin < 0) → `⚡ Fire arrival imminent — maximize contraflow` (red)
- Margin critical & not at L3 → `⚡ Margin critical — click zone or voice: "Upgrade X to GO"` (red)
- Route overloaded → `→ Route overloaded — voice: "Contraflow I-15"` (amber)
- Margin tightening → `→ Consider upgrading to LEVEL N` (amber)
- High % evacuated → `✓ 80%+ clear — monitor for stragglers` (green)

**4. Dynamic evac banner hint in `HUD.js` + `index.html`.** The static hint line is now `id="evac-banner-hint"` and rewritten by `updateEvacBanner()` on every evacuation update. Priority order: no-route alert → overloaded route → critical margin upgrade → wind direction label + Red Flag badge. Example: `Wind pushing fire NE · 🚩 RED FLAG · Click zone to cycle level`.

**Verification.** `npm run build` clean (605 kB, 159 kB gzipped). `node server/_selftest.js` PASSED. `node server/_e2e.js` PASSED.

---

## 2026-05-08 — session 7

**User-reported pain points fixed + real Census data wired.**

**Time display + cadence (user request).** Server tick now 2000ms / += 1 sim-min (was 1000ms / += 0.5). HUD displays `HH:MM` 24-hour military time anchored to `scenario.scenarioMeta.ignitionTime` (Cedar 2003: 17:37, Witch 2007: 12:35). Each visible tick is a clean integer-minute step lasting 2 wall-seconds; fixes "T+00:30 each time, going too fast."

**Pause/resume.** New `sim:toggle` action. `StateManager.toggleSim()` flips `simRunning` and broadcasts `sim` event. `CellularAutomata.setPaused()` gates `step()` so the fire freezes too. HUD pause button + `P` keybinding. `snapshot.simRunning` so late joiners pick up state.

**Blocker unselect bug.** Client `edge:update` handler now syncs `this.scenario.edges[i].blocked` and `.contra` so re-clicking a blocked road actually unblocks instead of re-blocking. The X marker comes off as expected.

**EVACUATE mode value.** Was visually distinct but unclear what the user could DO. Now:
- Top-screen banner appears in EVACUATE mode showing live aggregate stats: total residents, % evacuated, critical zone + margin (color-coded: red if margin < 0, orange if < 15), bottleneck count. Updates on snapshot/evacuation events.
- **Click any zone polygon to cycle level** (READY → SET → GO → READY). `ZoneRenderer.pickZone` raycasts against zone meshes; `_handleCanvasClick` routes by mode (COMMAND → roads, EVACUATE → zones).
- Hint line on the banner reminds the user what they can do.

**Real US Census data (using user-provided key).** New `server/services/CensusService.js` queries ACS 2022 5-year tables on startup for County + 4 places. Successfully retrieved live: San Diego County 3,289,701; San Diego City 1,383,987; Poway 48,737; Escondido 61,942. Some CDP codes (Ramona, Lakeside, Scripps Ranch) aren't queryable at place granularity in ACS 2022 — dropped to incorporated cities only. EvacuationPanel renders real numbers in a green-banded "REAL POPULATION (US Census ACS 2022)" section above scenario stats; AI advisor also gets these in context for grounding.

**Gates.** `npm run build` clean. `node server/_selftest.js` 25/25. `node server/_e2e.js` 14/14. Live API roundtrips: OpenAI ~2.5 s, FIRMS ~0.4 s, Census ~2.6 s.

---

## 2026-05-08 — session 6

**Gemini → OpenAI swap, live NASA FIRMS feed, historical Cedar Fire metadata.** Single batch, gates green.

**1. AI backend swap (Gemini → OpenAI gpt-4o-mini).** Replaced `@google/generative-ai` with `openai@^4.73.0`. `AIAdvisor` constructor now creates an OpenAI client gated on `OPENAI_API_KEY`. `ask()` uses Chat Completions with `max_tokens: 220, temperature: 0.25, model: 'gpt-4o-mini'`. Mock fallback unchanged. Live ping confirmed: ~2.5 s typical latency, severity classification working. Same `{ severity, source, text, prompt }` return shape so all consumers stay unchanged.

**2. Live NASA FIRMS hotspot feed (`server/services/FIRMSService.js`).** New service polls NASA FIRMS' VIIRS_SNPP_NRT API every 30 min for the California bounding box (`-125,32,-114,42`), parses CSV, broadcasts `{ available, count, hotspots, fetchedAt }` via the `firms` socket event. Live ping returned 51 active hotspots in 400 ms. Wired into:
   - `state.firms` field; carried in `snapshot()`.
   - HUD `setFirms` renders a `🛰 N CA hotspots` badge in the status bar.
   - `AIAdvisor.buildContext` injects a `LIVE STATEWIDE FIRE ACTIVITY` block listing count + top hotspots by FRP, so the advisor can reference real wildfires alongside the simulated scenario.

**3. Real 2003 Cedar Fire / 2007 Witch Creek metadata.** `SCENARIOS` dict now embeds `meta` per scenario:
   - **Cedar 2003**: ignited 2003-10-25 17:37 PDT by lost hunter's flare at (33.0356, -116.7); 273,246 acres, 15 fatalities, 2,820 homes destroyed, ~70,000 evacuated, Santa Ana NE 40-60 mph during event.
   - **Witch Creek 2007**: ignited 2007-10-21 12:35 PDT by SDG&E power line arc at (33.0833, -116.7167); 197,990 acres, 2 fatalities, 1,650 homes, ~500,000 evacuated.
   - **Plumas Approach**: marked synthetic worst-case.

   Meta is carried through `publicScenario.scenarioMeta`, surfaced in `EvacuationPanel` as a header banner, and injected into the AI advisor's context so it can reference real-world facts ("This is similar to the 2003 Cedar Fire which destroyed 2820 homes").

**4. Hermetic e2e gate.** `MM_FORCE_MOCK=1` env var explicitly disables OpenAI / FIRMS clients regardless of key presence. `_e2e.js` sets it (plus scrubs real keys from spawn env defensively) so the gate doesn't depend on external API roundtrips.

**Verification.** `npm run build` clean. `node server/_selftest.js` 25/25. `node server/_e2e.js` 14/14. Live OpenAI roundtrip confirmed (gpt-4o-mini, 2.5 s). Live FIRMS roundtrip confirmed (51 hotspots, 400 ms).

**Next priorities (still open):** AR / Quest 3 / HTTPS path, hardware UNO physical end-to-end test, real-data swap-in (USGS 3DEP terrain + LANDFIRE FBFM40 fuel + Census tract populations using the new keys), 30-min/1-hr fire projection ghost layer.

---

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
