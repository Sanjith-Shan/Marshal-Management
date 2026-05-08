# Marshal Management

**AR fire-marshal command center — Reboot the Earth 2026, UCSD.**

A 3D topographic map of the active fire zone — viewable on your desktop or as immersive AR on a Meta Quest 3. Live fire spread (Rothermel-lite cellular automata), capacity-aware evacuation routing (Dijkstra + BPR congestion), AI strategic advisor (Gemini 2.5 Flash with full state context), and an optional physical command board (Arduino UNO over USB serial). Keyboard fallback for everything.

## Quick start

```bash
npm install
npm run dev
```

- **Server:** http://localhost:3000 (Socket.IO + REST)
- **Client (desktop):** http://localhost:5173

Open the client URL in any modern browser. Click **Enter AR** in a Quest 3 browser to switch to immersive passthrough mode.

### Optional: live AI advisor

```bash
cp .env.example .env
# edit .env and set GEMINI_API_KEY
```

Without a key, the rules-based **mock-advisor** answers using the same context format. The mock is scenario-aware — it names zones, identifies bottlenecks, recommends contraflow.

### Optional: hardware command board

Wire the Arduino as documented in `arduino/marshal_board/marshal_board.ino` and plug into USB. The server auto-detects the port. If no Arduino is present, the keyboard fallback is used.

## Controls

| Key | Action |
|---|---|
| Mouse drag / WASD | Rotate / pan terrain |
| Wheel / Q / Z | Zoom in / out |
| **1 – 4** | Toggle panels: Weather / Evacuation / AI / Video |
| **E** | EVACUATE — run the routing engine |
| **M** | Cycle mode: Monitor / Command / Evacuate |
| **R** | Reset scenario |
| **Space** (hold) | Push-to-talk to AI advisor |
| **T** | Toggle timeline scrubber |
| **?** | Show help overlay |
| Click road in Command mode | Toggle blocked |

## What's running where

```
client/                   Vite + Three.js + WebXR
  ar/                     SceneRoot, ARSession (immersive-ar)
  terrain/                Procedural heightmap → displaced PlaneGeometry
  fire/                   CellularAutomata (Rothermel-lite) + FireOverlay shader
  evacuation/             Roads / Zones / Routes / Bottlenecks / Shelters / PopulationDots
  panels/                 Weather, Evacuation, AI, Video — DOM glass-morphism
  interaction/            DesktopControls, Keybindings, VoiceInput (Web Speech API)
  ui/                     HUD, styles
server/                   Express + Socket.IO
  services/
    ScenarioBuilder.js    Procedurally builds terrain, road network, populations, shelters
    StateManager.js       Single source of truth, broadcasts deltas
    EvacuationEngine.js   Capacity-aware Dijkstra + BPR congestion + zone classification
    WeatherService.js     NWS api.weather.gov polling with mock fallback
    AIAdvisor.js          Gemini 2.5 Flash with full context, mock fallback
    ArduinoService.js     USB-serial reader (optional) → mirrors keyboard events
arduino/marshal_board/    Firmware for the optional hardware control board
```

## Demo flow

1. Open the client. The terrain renders. Fire begins spreading from a seeded ignition point in the NE quadrant.
2. Press **1**, **2**, **3** to bring up the Weather, Evacuation, and AI Advisor panels.
3. As fire propagates, zones automatically update from **L1 Ready** → **L2 Set** → **L3 Go**.
4. Press **E** to run the evacuation engine. Routes light up green with animated arrows. Bottlenecks pulse orange.
5. Press **M** to switch to **Command** mode, then click a road segment to mark it as blocked. Routes replan.
6. Hold **Space** and ask the AI: *"What's my biggest risk right now?"* — it responds with specific zone names, ETA windows, and bottleneck recommendations.
7. Press **R** to reset and replay.

## Architecture decisions for the hackathon

The full v3 spec called for OSMnx-derived OpenStreetMap data, US Census ACS populations, USGS 3DEP DEMs, LANDFIRE FBFM40 fuel grids, and pre-baked satellite imagery. To finish in the 24-hour build window, all of these are replaced by **deterministic procedural generation seeded from `ScenarioBuilder.js`** — yielding a 503-node, 860-edge synthetic San Diego–like network with 10,100 residents distributed across three zones (Scripps Ranch, Poway, Ramona) and three shelters (Alliant Univ., Poway HS, Qualcomm Stadium). The engine is real and would accept real GeoJSON drop-in replacements.

NWS weather is **live** (`api.weather.gov` requires no key). Gemini AI is live if a key is set. Arduino is live if a board is plugged in. Everything else has a working mock fallback.

## Self-tests

```bash
node server/_selftest.js     # scenario + evac engine + AI smoke tests
node server/_e2e.js          # boots server, runs full socket round-trip
```

Both should report `PASSED`.

## Build for production

```bash
npm run build      # compiles the Vite client into ./dist
npm start          # runs the server, which serves ./dist
```
