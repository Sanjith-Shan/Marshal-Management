# Marshal Management — Build Log

**Hackathon:** Reboot the Earth 2026 | UCSD | May 8–9, 2026
**Status:** In Progress

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

- `npm run build` — 27 modules, 538 kB gzipped 138 kB, 0 errors
- `node server/_selftest.js` — 9/9 passed (scenario, evac, AI smoke)
- `node server/_e2e.js` — 9/9 passed (socket round-trip)
- Headless Chrome screenshot — page renders, no JS errors

## Feature coverage vs v3 spec

> **Read with skepticism.** Each row is a single developer's read of the code. 🟢 means real and validated; 🟡 means works but with substitutions or partial behavior; 🔴 means scaffolded only, untested, or visibly thin. If a status feels wrong when you load the demo, it probably is — re-grade it.

| v3 Feature | Status | What's actually there |
|---|---|---|
| 1. AR Tabletop Terrain Map | 🟡 | Heightmap and texture are **procedural**, not USGS/satellite. Plane detection / RATK anchoring **not integrated** — terrain is hardcoded `(0, 0.05, -1.2)` in front of viewer in AR. |
| 2. Live Fire Spread Simulation | 🟡 | Rothermel-lite CA + wind + slope + embers all real. Fuel grid is **procedural** (no LANDFIRE). No 30-min / 1-hr projection visuals — only current state. Timeline scrubber decorative. |
| 3. Evacuation Planning System | 🟢 / 🟡 | Engine is real (Dijkstra + BPR + capacity-aware multi-source). Operates on a **synthetic road network**. Only primary route computed (no secondary/alternate). |
| 4. Floating AR Information Panels | 🟡 | Real and styled — but **DOM, not 3D Three.js planes**. In Quest passthrough they may not appear at all. |
| 5. AI Strategic Advisor | 🟡 | Gemini path real if key set. AI **cannot trigger actions** ("Upgrade Zone B to Go" produces text only, no state mutation). Proactive scan only writes to panel, not terrain. No voice output. |
| 6. Voice + Hand + Hardware Control | 🔴 / 🟡 | Voice input + keyboard fallback work. **Hand tracking 0% implemented.** Gesture detection 0%. Hardware firmware written but **never validated on physical UNO**. |
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
4. Voice can't trigger actions. Spec listed several voice intents that just don't fire.
5. AI advisor has no voice output. Web SpeechSynthesis is one call away.
6. Population dots don't actually flow along routes — they fade in place.

**Medium (rough edges or cosmetic gaps from spec):**

7. No 30-min / 1-hr fire projection layer. Timeline slider is decorative.
8. Engine produces only primary route; no secondary/alternate.
9. Contraflow has no animated visual (color flip only).
10. Blocked roads turn red but don't show pulsing X markers.
11. Mode switch is ~cosmetic (only COMMAND has behavior).
12. `data/demo-scenarios/` is empty. No saved Cedar Fire scenario states.
13. Proactive AI only updates the panel — no terrain overlays.
14. Performance on Quest 3 untested. May need 64×64 CA fallback.

**Stretch (spec stretch goals or polish):**

15. Multi-user — broadcast already shaped for it; no UI/lobby.
16. Historical replay — load real 2003 Cedar Fire FIRMS timeline.
17. Phone companion — Leaflet 2D mirror.
18. Sound design — alarms, click feedback, radio chatter.
19. Bottleneck markers don't show capacity %, hwy class, or alt routes.
20. Shelter overflow has no UI signal.
21. Reset only re-seeds the same scenario; no scenario picker.

### TODO group H — time-control buttons + UNO Q migration *(supersedes / refines item 7 above and the Hardware row in §"Known mocks")*

> User-requested addition. Two physical buttons on the hardware board for jumping the simulation forward/back in time, **plus a platform migration** of the entire hardware integration from classic UNO + USB serial to Arduino UNO Q + wireless. The two are bundled here because both touch firmware and `ArduinoService.js`, and doing them together avoids two firmware rewrites.

**H1 — Two new hardware controls.** Forward (`TIME_FWD`) and back (`TIME_BACK`) buttons. Forward jumps `simTimeMin` by +30 / +60 min (single press / hold), fast-forwards the fire CA the equivalent number of steps, and re-runs `EvacuationEngine` so zones / routes / bottlenecks reflect the new state. Back rewinds by the same step. This refines and replaces the currently-decorative timeline scrubber (Medium gap #7).

**H2 — Server-side time-jump API.** New `socket.emit('action', { type: 'time-jump', payload: { deltaMin: +30 } })`. Server: advance `state.simTimeMin`, ask the client CA to fast-step to match (or run a server-side mirror CA), recompute evacuation, broadcast snapshot.

**H3 — Reverse time is non-trivial.** The fire CA is forward-only / non-reversible. Pick one of two strategies (decision deferred — see open question below):
  - **Snapshot ring buffer:** every 5 sim-min, push `{ fire.state, fire.arrival, weather, evacuation }` onto a circular buffer (e.g. 24 entries = 2 hr of history). Back-button restores from the closest snapshot.
  - **Deterministic re-sim:** seed the CA's `Math.random()` from the scenario seed + step index, and re-simulate from t=0 to `target` on rewind. Slower but uses no extra memory and gives bit-identical replay.

**H4 — Migrate firmware target to Arduino UNO Q.** Existing `arduino/marshal_board/marshal_board.ino` is for classic UNO + Arduino IDE. UNO Q uses **Arduino App Lab** (web IDE, different sketch conventions, can leverage onboard MPU/Linux side). Add `arduino/marshal_board_q/` as the new authoring location. **Keep the classic UNO sketch as a reference** — don't delete; it's a working CSV protocol the wireless path can mirror.

**H5 — Drop USB serial; move to wireless.** UNO Q has WiFi / BLE built in and will be powered by a portable battery, untethered. Replace `ArduinoService.js`'s `serialport` reader with a network endpoint:
  - Recommended: UNO Q runs a WebSocket *client* and connects to the server's existing Socket.IO (or a dedicated `/board` namespace), POSTs button events as the same `{ type, payload }` action shape the keyboard fallback uses.
  - Alternatives: MQTT broker (extra moving part); HTTP POST per event (chatty but simple); BLE (only if the server host is also a BLE peripheral, which complicates deployment).
  - Existing `ArduinoService.js` should stay as a fallback path (USB still works for development on a laptop) but the production target is the WiFi path.

**H6 — Pairing / discovery UX.** Without USB autodetect, the user needs a way to connect the board to the running server. Likely: server prints a join URL or 6-digit code at startup; UNO Q prompts (or is pre-configured) with WiFi SSID + server URL.

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
- (H3) For time-rewind: snapshot ring buffer vs deterministic re-sim — which is right? Snapshot is faster and simpler; re-sim gives bit-identical replay and pairs naturally with multi-user (stretch goal #15). Decide before building H1.
- (H4) Does Arduino App Lab support standard `.ino`-style sketches, or does it require a different project layout / build manifest? Confirm before porting.
- (H5) Is the WiFi / WebSocket round-trip fast enough for the joystick (~30 Hz)? Buttons are edge-triggered so latency tolerance is high, but joystick streaming may need throttling or a different transport.
- (H5) If the UNO Q drops WiFi mid-demo, what's the failure UX? Currently nothing — keyboard fallback masks it but there's no visible "board offline" indicator.
- (H1) Should "forward 30 min" advance the *whole* sim (clock + fire + weather + evac), or just the fire-projection visualization layer? The first is honest, the second is faster but means the rewound state is fake. Spec language ("see the fire spread in 30 minutes") suggests the first.
- (H1) On forward-jump, does the AI advisor's proactive scan also re-run, or stay on its 60-second wall-clock cadence? If sim-time jumps but real-time doesn't, the advisor will lag.

## Re-grading guidance

When the next session opens this repo, suggested 5-minute pass:
1. Run `npm run dev`, open browser, press `E`, click a road in Command mode, hold Space and ask a question.
2. Compare the experience to each 🟢 / 🟡 / 🔴 row above.
3. **If a 🟢 looks weaker than claimed, downgrade it and add a note.** Over-stating progress is the failure mode that costs the next session the most time.
4. Skim the "Open questions" section for anything that's now answerable from observation, and resolve those entries (move them up to known gaps or delete them).
