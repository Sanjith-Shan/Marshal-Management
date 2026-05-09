# Marshal Management — Build Log

**Hackathon:** Reboot the Earth 2026 | UCSD | May 8–9, 2026
**Status:** Desktop demo shippable. AR + hardware unvalidated on real devices.

---

## Current state (snapshot)

- **Desktop demo works end-to-end.** `npm run dev` → http://localhost:5173. Real OSM, DEM, NWS, Census, FIRMS, NIFC, OpenAI live.
- **Routing:** per-zone closest-shelter affinity (zones processed by closest-cost ascending). Each zone fills its local shelter first; overflow goes to next-closest. Qualcomm Stadium kept as 8000-cap reserve for compromise demos.
- **Scenario:** 8 zones (Scripps Ranch, Poway, Ramona, Mira Mesa, Rancho Peñasquitos, La Jolla/UCSD, Downtown SD, North Park), 6 shelters (Qualcomm 8000, Mira Mesa HS 6500, Poway HS 4800, Ramona Senior HS 5500, SDSU Aztec Stadium 4000, UCSD East Campus 4000).
- **Block-road:** one click = one edge, click again to remove. (Reverted earlier cluster-block per user instruction.)
- **Dots:** flow at ALL levels (READY 0.012/s, SET 0.025/s, GO 0.06/s). Direction always population → shelter (orientPolyline defensive).
- **WebXR pass (just landed, untested on hw):** xrCompatible context, NoToneMapping in AR, render-mode swap before setSession, 3-tier session feature fallback, local→local-floor reference space fallback, XR button gated until `_buildWorld` completes, debounce on Enter-AR, desktop controls + canvas clicks skipped in AR, near plane 0.05→0.1.

---

## Tiers (recomputed for finish-in-next-few-hours)

Ranked by demo-impact-per-effort. Desktop demo is already shippable, so everything below is incremental.

### Tier 1 — Validate AR on real Quest 3 (highest unknown)

The deep WebXR pass is in the code but unvalidated on hardware. This is the single biggest risk to a demo that pitches AR.

- [ ] **1A.** Restart server with HTTPS (`HTTPS=1 node server/index.js` + `HTTPS=1 npx vite`). Load `https://<lan-ip>:5173` on Quest 3, accept cert, click **Enter AR**.
- [ ] **1B.** If AR fails, the on-page error overlay (wired in `index.html`) reports the throw. Read banner → fix specific issue (likely reference-space failure, dom-overlay rejection, or long `_buildWorld` blocking).
- [ ] **1C.** If AR runs but is choppy: profile via `chrome://inspect` USB. Most likely culprit is 41k OSM edges + per-frame fire CA at 128×128. Fallback: drop CA to 64×64 in AR, hide pick proxy in AR (saves raycasting).
- [ ] **1D.** DOM panels in passthrough are known-broken (panels render to canvas overlay). For demo: exit AR to read panels, or accept the limitation. 3D-ported panels are out of scope here.

**Blockers:** physical Quest 3 + same Wi-Fi as Mac.

### Tier 2 — Hardware UNO Q smoke test (high impact if working)

UNO Q + Python + Socket.IO + Bridge.notify pipeline complete in code, never run on real board.

- [ ] **2A.** Flash UNO Q via Arduino App Lab. Confirm `Bridge.notify("button","weather")` reaches the server's `'action'` channel and toggles the weather panel.
- [ ] **2B.** Joystick A0/A1 → `'joystick'` action → desktop pulseRotate. Verify ~30 Hz throughput is acceptable; throttle Python-side if jittery.
- [ ] **2C.** Demo plan if the board doesn't connect: keyboard shortcut works; show the App Lab project + sketch as proof-of-concept.

**Blockers:** UNO Q hardware + WiFi config.

### Tier 3 — Performance audit at real density (defensive)

Pick proxy raycasting at ~3k major-class edges runs on every COMMAND-mode mousemove. May lag on Quest CPU. Untested.

- [ ] **3A.** Measure desktop frame time when hovering roads in COMMAND mode. If > 16 ms, switch pick proxy to InstancedMesh or filter to motorway/trunk only.
- [ ] **3B.** `_buildWorld` synchronous build is 1–3 s on desktop, likely 3–8 s on Quest. Yield to event loop between heavy renderers (TerrainMesh → RoadRenderer → ZoneRenderer) so the page doesn't appear frozen during AR entry.

### Tier 4 — Demo polish (low risk, optional)

- [ ] **4A.** Canonical savepoint (`data/demo-scenarios/cedar-t30-i15-blocked.json`) so the same demo runs every time. Blocked by unseeded CA RNG — would need to seed `CellularAutomata`'s `Math.random()` calls.
- [ ] **4B.** Shelter-overflow UI signal (silent today when capacity exceeded).
- [ ] **4C.** Sound design (radio chatter, alarms on zone escalation, click feedback).

### Tier 5 — Deferred (NOT in scope for next few hours)

- LANDFIRE FBFM40 real fuel grid (requires geotiff.js + multi-band raster parse).
- 30/60-min fire projection ghost layer.
- "What if we lose I-15?" hypothetical mode.
- RATK plane detection / anchors.
- 3D-ported AR panels.
- Hand tracking.
- Multi-user, phone companion, historical FIRMS replay.
- Slope physics re-tune for real DEM gradients.
- Census tract-level per-node population assignment.

---

## Feature coverage vs v3 spec

| v3 Feature | Status | Notes |
|---|---|---|
| 1. AR Tabletop Terrain Map | 🟢 desktop / 🔴 AR | Real DEM + OSM + compass + wind arrow. AR pass coded, untested on Quest. |
| 2. Live Fire Spread Simulation | 🟢 | Wind asymmetry 4.3× at 35 kph, ember spotting visible, slope floor fixed. Procedural fuel. |
| 3. Evacuation Planning System | 🟢 | Per-zone Dijkstra + BPR + wind penalty + multi-shelter overflow + secondary routes + reroute advisor messages. |
| 4. Floating AR Information Panels | 🟢 desktop / 🔴 AR | DOM panels work on desktop; invisible in passthrough. |
| 5. AI Strategic Advisor | 🟢 | OpenAI gpt-4o-mini + voice output + intent → state mutation + proactive scan with terrain triangles. |
| 6. Voice + Hand + Hardware | 🟡 | Voice input REMOVED. UNO Q wired in code, untested. Hand tracking 0%. |
| 7. Live Data Feeds | 🟢 | NWS + FIRMS + Census + OSM + 3DEP + NIFC perimeter all live. |

---

## Architecture

```
client/  Vite + Three.js + WebXR
server/  Node + Express + Socket.IO + OpenAI + (optional) serialport
arduino/
  marshal_board/    classic UNO + USB serial (reference)
  marshal_board_q/  UNO Q App Lab + WiFi + Python Socket.IO (production target)
```

State flow: client → `socket.emit('action', {type, payload})` → server `handleAction` → `StateManager` mutator → `broadcast`. Never mutate state outside `StateManager`.

Snapshot on connect; deltas after (`evacuation`, `weather`, `edge:update`, `advisor`, `mode`, `panels`, `tick`).

Every renderer exposes `applySnapshot(snap)`, optional `update(dt)`, and `setEvacMode(active)` for mode-aware fades.

---

## Run modes

1. **Desktop** (default, primary): `npm run dev` → http://localhost:5173. Mouse + keyboard, DOM panels.
2. **Quest 3 / WebXR AR**: `HTTPS=1 npm run dev` → https://<lan-ip>:5173. Same scene, terrain anchored at fixed offset (0, 1.0, -0.7) scale 0.35; no plane detection yet.
3. **Hardware board**: UNO Q on phone hotspot, with a **host-side socat forwarder** to bridge the App Lab Docker container's network namespace (2026-05-09). Container is on Docker bridge `172.20.0.0/16` which overlaps the iPhone hotspot subnet `172.20.10.0/28`, so the container can't reach the Mac directly — kernel routes 172.20.10.8 to the local bridge instead of wlan0. Workaround: `socat TCP4-LISTEN:3000,fork,reuseaddr TCP4:<MAC_IP>:3000` runs on the UNO Q host; container connects to bridge gateway `172.20.0.1:3000` instead. `python/main.py` SERVER_URL = `http://172.20.0.1:3000`. ADB-reverse was tried first but the UNO Q's adbd doesn't honor reverse-forward — `[Errno 111] Connection refused` on device-side loopback. **Auto-start**: `/home/arduino/socat-marshal.sh` (waits for wlan0 to get a 172.20.10.x IP, then launches socat) runs at every boot via user crontab `@reboot`. Hardcodes MAC_IP=172.20.10.8 — edit script if Mac gets a different hotspot IP. Demo: hotspot ON (Maximize Compatibility) → Mac joins → `npm run dev` → plug UNO Q USB-C → App Lab Run. Keyboard always works as fallback.

---

## Demo flow (3 min)

1. Open browser → terrain materializes, fire spreads from Cedar Creek.
2. `1`–`4` toggle panels (Weather / Evac / AI / Video).
3. `E` triggers evacuation → zones color, dots flow toward local shelters.
4. **COMMAND mode (`M` cycles):**
   - Click road to block (single edge, click X to unblock).
   - Click shelter diamond to compromise (toggles flag, never deletes).
   - Shift+click terrain to designate new shelter at nearest road node.
5. **EVACUATE mode:** click any zone polygon to cycle level (READY → SET → GO).
6. `F` overlays real 2003 Cedar Fire NIFC perimeter (270,686 acres).
7. `[` / `]` time-jump ±30 (Shift = ±60); `P` pause; `R` reset.

---

## Verification

```bash
npm run build                          # ~640 kB / ~170 kB gz, clean
node server/_selftest.js               # 25/25
MM_FORCE_MOCK=1 node server/_e2e.js    # 14/14 hermetic
```

---

## Persistent gotchas (load-bearing — re-read before refactoring)

- **`time-jump:applied` ack is load-bearing.** Server doesn't re-run evac on regular `fire:state` — only on this ack or manual action.
- **Server and client snapshot rings are independent.** Drift if socket stalls. Rewind tolerates miss (rebuilds fresh CA).
- **`fastForward(n)` does NOT call `setWind`.** Weather stays at last NWS poll value across jumps.
- **CA RNG is `Math.random()`, intentionally unseeded.** Don't add determinism casually — every spread roll, ember roll, burnout-time lookup needs a seeded source.
- **`pushAdvisorMessage` is the single hub for advisor output.** Wire new sources here; `appendAdvisor` in `main.js` is where every entry lands.
- **A new control wires in three places, not two.** Hardware ↔ keyboard ↔ HUD parity. `time-jump` is the canonical example.
- **Renderers parented to `terrainGroup` get scaled in AR (0.35).** Sprite-based markers (CompassMarkers, WindIndicator) need to compensate or risk being invisible.
- **OpenAI / FIRMS / Census keys live in `.env` (gitignored).** Rotate after demo.

---

## Scope decisions (substituted vs spec)

| Spec element | Hackathon approach |
|---|---|
| LANDFIRE FBFM40 fuel | Procedural 5-class grid (correlated to terrain) |
| Satellite texture | Procedural canvas from fuel + slope |
| Hand tracking / RATK | Not integrated (hardcoded AR offset) |
| 3D-ported AR panels | DOM only (invisible in passthrough) |

Everything else above runs on live APIs.
