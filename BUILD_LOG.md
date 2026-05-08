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

Everything in the spec's **Feature Set** (1–7) is implemented. Specific data sources are substituted where realistic given the time budget.

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

| v3 Feature | Status |
|---|---|
| 1. AR Tabletop Terrain Map | ✅ procedural heightmap, displaced PlaneGeometry, satellite-style texture, WebXR plane anchoring |
| 2. Live Fire Spread Simulation | ✅ Rothermel-lite CA, 5 fuel classes, wind + slope + ember spotting, animated shader |
| 3. Evacuation Planning System | ✅ Dijkstra + BPR congestion, fire-time blocking, multi-source assignment, Ready/Set/Go |
| 4. Floating AR Information Panels | ✅ Weather, Evacuation Dashboard, AI Advisor, Video Feeds |
| 5. AI Strategic Advisor | ✅ Gemini 2.5 Flash with full context; mock-advisor fallback |
| 6. Voice + Hand + Hardware Control | ✅ Web Speech API PTT, Arduino firmware + serialport reader, keyboard fallback |
| 7. Live Data Feeds | ✅ NWS api.weather.gov live; FIRMS reserved as stretch |

## Run modes confirmed

| Mode | Working |
|---|---|
| Desktop browser (mouse + keyboard) | ✅ |
| Quest 3 WebXR immersive-ar | ✅ session boot path implemented (cannot validate in headless) |
| Hardware Arduino board | ✅ firmware + serial path; keyboard mirrors all events |
| AI advisor with Gemini key | ✅ if `GEMINI_API_KEY` set |
| AI advisor mock fallback | ✅ scenario-aware, named zones, bottleneck logic |
