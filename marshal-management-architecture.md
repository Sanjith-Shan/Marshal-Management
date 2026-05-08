# Marshal Management — Full Architecture & Build Plan

## Reboot the Earth 2026 | UCSD | May 8–9

---

## Vision

A fire marshal puts on a Meta Quest 3. Through passthrough AR, they see their real table — and on it, a living, breathing 3D topographic map of the active fire zone. Fire spreads across the terrain in real-time. Floating panels orbit the workspace: live video feeds from field crews, wind/weather data, resource positions, AI recommendations. The marshal pinches to drop a water bomber on the map — the 3D water plane materializes, and the fire simulation reacts. They speak: *"What's my best containment line if wind shifts northwest at 20 mph?"* — and the AI advisor responds with a data-driven recommendation while the terrain visualization updates.

---

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    META QUEST 3 (AR)                     │
│  ┌──────────────────────────────────────────────────┐   │
│  │              WebXR Three.js App                   │   │
│  │  ┌────────────┐  ┌──────────┐  ┌──────────────┐ │   │
│  │  │ 3D Terrain │  │ Fire Sim │  │  AR Panels   │ │   │
│  │  │ (on table) │  │ (CA Grid)│  │ (floating UI)│ │   │
│  │  └────────────┘  └──────────┘  └──────────────┘ │   │
│  │  ┌────────────┐  ┌──────────┐  ┌──────────────┐ │   │
│  │  │ Hand Track  │  │  Voice   │  │  Gestures    │ │   │
│  │  │ (WebXR)    │  │ (Speech) │  │  (pinch/grab)│ │   │
│  │  └────────────┘  └──────────┘  └──────────────┘ │   │
│  └──────────────────────┬───────────────────────────┘   │
│                         │ WebSocket / HTTP               │
└─────────────────────────┼───────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │    Backend Server      │
              │    (Node/Express)      │
              │  ┌─────────────────┐  │
              │  │  AI Advisor     │  │
              │  │  (Gemini 2.5)   │  │
              │  └─────────────────┘  │
              │  ┌─────────────────┐  │
              │  │  Data Aggregator│  │
              │  │  (APIs → State) │  │
              │  └─────────────────┘  │
              │  ┌─────────────────┐  │
              │  │  Command Router │  │
              │  │  (NLP + SSE)    │  │
              │  └─────────────────┘  │
              └───────────┬───────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
   ┌─────┴─────┐  ┌──────┴──────┐  ┌──────┴──────┐
   │ NASA FIRMS │  │ NWS Weather │  │  LANDFIRE   │
   │ (hotspots) │  │ (wind/temp) │  │ (fuel data) │
   └───────────┘  └─────────────┘  └─────────────┘
```

---

## Core Feature Set

### 1. AR Tabletop Terrain Map

**What the marshal sees:** A photorealistic 3D terrain model, miniaturized and anchored to their physical table via WebXR plane detection. They can walk around it, lean in to inspect ridgelines, and interact with it using hand gestures.

**Technical approach:**

- **Rendering engine:** Three.js with WebXR (`immersive-ar` session mode)
- **Terrain source — two options (pick based on hackathon time):**
  - **Option A (faster, recommended for hackathon):** Pre-baked heightmap terrain. Use USGS 3DEP elevation data (10m or 30m resolution) for your target area. Fetch the DEM tile via OpenTopography API or the USGS National Map ImageServer endpoint (`elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer`). Convert the heightmap into a Three.js `PlaneGeometry` with vertex displacement. Drape a satellite texture (Mapbox Static Tiles API or a pre-downloaded tile) on top.
  - **Option B (prettier, more complex):** Google Photorealistic 3D Tiles via `3DTilesRendererJS` (NASA-AMMOS library). Loads real photogrammetric mesh data. Requires a Google Maps API key with Map Tiles API enabled. More visually stunning but harder to raycast against for fire simulation overlay.
- **Table anchoring:** Use Meta's Reality Accelerator Toolkit (RATK) for Three.js. Request `plane-detection` and `anchors` as required WebXR features. On session start, detect horizontal planes, find the table surface (semantic label `"table"` or largest horizontal plane), and create an anchor. Parent the terrain Group to this anchor.
- **Scale & interaction:** The terrain renders at approximately 60cm × 60cm on the table. Pinch-to-zoom scales it. Grab to rotate. The marshal can lean in and the parallax is real — this is genuine 3D, not a flat map.

**Key code pattern for AR session:**
```
requiredFeatures: ['hit-test', 'plane-detection', 'anchors', 'hand-tracking']
// Session mode: 'immersive-ar' for passthrough
// Set renderer alpha: true, and scene background to null for transparency
```

### 2. Fire Spread Simulation (Rothermel Cellular Automata)

**What the marshal sees:** An animated fire overlay painted directly on the terrain mesh. Red = active fire. Orange = projected 30-min spread. Yellow = 1-hour projection. The fire moves, breathes, and responds to wind changes in real-time.

**Technical approach:**

- **Simulation grid:** 128×128 or 256×256 cellular automata grid overlaid on the terrain bounding box. Each cell stores: fuel type (from LANDFIRE FBFM40), elevation (from DEM), moisture content, fire state (unburned/burning/burned), and ignition time.
- **Rothermel spread rate:** Implement the simplified Rothermel (1972) rate-of-spread formula:
  ```
  R = R0 × (1 + φ_w + φ_s) / ε
  where:
    R0 = base spread rate (from fuel model lookup table)
    φ_w = wind factor = C × (U/U_ref)^B × (β/β_op)^E
    φ_s = slope factor = 5.275 × β^-0.3 × tan²(θ)
    ε = effective heating number
  ```
  For hackathon, simplify to 5 fuel type classes with pre-computed R0 values:
  - Chaparral (Southern CA default): R0 ≈ 4.0 m/min
  - Grass: R0 ≈ 6.0 m/min
  - Timber litter: R0 ≈ 1.5 m/min
  - Urban: R0 ≈ 0.5 m/min
  - Rock/Water: R0 = 0 (non-burnable)
- **Wind integration:** Wind direction rotates the spread ellipse. Wind speed amplifies the head fire rate. The simulation pulls live wind data from the NWS API (see Data Feeds below) and applies it globally across the grid.
- **Slope effect:** Calculated from the DEM. Uphill spread accelerates (fire preheats fuel above it). Downhill spread decelerates.
- **Ember spotting:** Probabilistic — at each timestep, burning cells with high wind exposure have a small probability (~2–5%) of igniting cells 3–8 cells downwind, simulating spot fires.
- **Rendering:** The CA grid is rendered as a semi-transparent texture overlaid on the terrain mesh. Use a custom ShaderMaterial with animated UVs — the fire edge pulses and glows. Color-code by time-since-ignition for the projection bands.
- **Timeline scrubber:** A UI element (floating AR panel) lets the marshal slide from t=now to t=+3 hours. The simulation pre-computes forward steps and stores snapshots. Scrubbing interpolates between snapshots.

### 3. Intervention System (Water Drops & Containment Lines)

**What the marshal sees:** They pinch to select a "water drop" tool from a floating toolbar, then point at the terrain and release — a 3D water plane materializes (translucent blue disc with splash particle effect), and the fire spread recalculates around the wet zone.

**Technical approach:**

- **Intervention types:**
  - **Water drop:** Creates a circular suppression zone (radius configurable). Cells within the zone get their fuel moisture raised to 200%+ (effectively non-burnable for ~30 simulated minutes). Rendered as a translucent blue disc with animated ripple shader.
  - **Retardant line:** Draw a line on the terrain (hand-tracked finger painting). Creates a 2-cell-wide strip of fire-resistant cells. Rendered as a red/orange line on the terrain.
  - **Firebreak/backfire:** Mark a line where you want to do a controlled burn ahead of the main fire. The CA ignites cells along the line, creating a burned-out barrier.
- **Interaction flow:** Floating tool palette → select tool → point at terrain (raycast from hand) → pinch to place/draw → simulation reacts.
- **Simulation reaction:** When an intervention is placed, the CA grid is modified (fuel moisture, fuel state) and the forward projection recalculates from the current state. The marshal sees the fire contours shift in real-time.

### 4. Floating AR Information Panels

**What the marshal sees:** Spatial panels floating at comfortable viewing angles around the workspace. Each panel can be grabbed and repositioned. They render as transparent-background HTML textures on Three.js planes.

**Panel inventory:**

| Panel | Content | Data Source |
|-------|---------|-------------|
| **Weather** | Wind speed/direction (animated arrow), temperature, humidity, gusts, Red Flag warnings | NWS API (`api.weather.gov`) |
| **Fire Status** | Active acres, containment %, rate of spread, estimated arrival times to landmarks | Computed from CA simulation |
| **Resource Tracker** | Engine crews, helicopters, hand crews — position icons on terrain, status (en route / on scene / staging) | Manual input + mock data |
| **Video Feeds** | 2–4 simulated live video feeds from "field cameras" (mock or looping video) | Local video files or WebRTC mock |
| **AI Advisor** | Scrolling recommendation feed — the AI's latest analysis, warnings, suggestions | Backend AI engine |
| **Comms** | Voice command transcript, recent orders issued, acknowledgments | Web Speech API transcript |

**Rendering approach:** Use `three-mesh-ui` or render HTML to Canvas → CanvasTexture → Three.js Plane. Each panel is a `Group` with a background plane + content plane. Panels have a subtle glass-morphism effect (blurred transparent background) to feel native to the AR environment.

**Interaction:** Panels respond to hand proximity — they brighten when the marshal's hand is near. Pinch-and-drag to reposition. Pinch the corner to resize.

### 5. AI Strategic Advisor

**What the marshal hears/sees:** A persistent AI co-pilot that synthesizes ALL data streams and provides spoken + visual recommendations. The marshal can talk to it naturally.

**Architecture:**

```
┌──────────────────────────────────────────────────┐
│                  AI ADVISOR PIPELINE              │
│                                                   │
│  Voice Input (Web Speech API)                     │
│       ↓                                           │
│  Transcript → Backend via WebSocket               │
│       ↓                                           │
│  Context Assembly:                                │
│    • Current fire state (CA grid snapshot)         │
│    • Wind/weather data (latest NWS pull)           │
│    • Resource positions                            │
│    • Recent interventions                          │
│    • Terrain features (elevation, fuel types)      │
│    • Historical fire behavior in area              │
│       ↓                                           │
│  Gemini 2.5 Flash (structured prompt)             │
│       ↓                                           │
│  Response: {                                      │
│    text: "Recommend repositioning...",             │
│    urgency: "high",                               │
│    actions: [{type: "reposition", ...}],           │
│    overlays: [{type: "highlight_zone", ...}]       │
│  }                                                │
│       ↓                                           │
│  TTS (ElevenLabs or Web Speech Synthesis)         │
│  + Visual overlay on terrain                      │
│  + AI Panel update                                │
└──────────────────────────────────────────────────┘
```

**System prompt structure for Gemini:**
```
You are Marshal AI, a wildfire tactical advisor embedded in an AR command 
system. You have access to the following real-time data:

FIRE STATE: [serialized CA grid summary — active cells, spread direction, 
rate, containment gaps]
WEATHER: [wind speed/dir, temp, humidity, forecast next 6h]
TERRAIN: [elevation profile, fuel types in fire path]
RESOURCES: [list of crews, positions, availability]
RECENT ACTIONS: [last 10 commands issued by the marshal]

Your role:
- Proactively warn about dangers (wind shifts pushing fire toward 
  populated areas, crew safety zones compromised)
- Suggest tactical moves (where to place water drops, when to go 
  defensive, optimal containment line locations)
- Answer direct questions with data-backed reasoning
- Be concise — the marshal is in a crisis. No fluff.
```

**Proactive mode:** Every 60 seconds, the backend auto-queries the AI with the latest state snapshot and a prompt: *"Analyze current situation. Any urgent warnings or recommendations?"* Results push to the AI Panel via SSE.

**Voice interaction:** Web Speech API for continuous listening with a wake word approach or push-to-talk (pinch both hands = "I'm talking to the AI"). Gemini processes the transcript + full context. Response is spoken via ElevenLabs (if you have the API key) or browser SpeechSynthesis as fallback.

### 6. Live Data Feeds

| Data Source | API | Update Frequency | What It Provides |
|---|---|---|---|
| **NASA FIRMS** | `firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/VIIRS_NOAA20_NRT/{bbox}/1` | Poll every 5 min | Real active fire hotspot coordinates, brightness, confidence, FRP (fire radiative power). Initialize CA grid ignition points from this. |
| **NWS Weather** | `api.weather.gov/stations/{STATION_ID}/observations/latest` | Poll every 5 min | Wind speed (m/s), wind direction (degrees), temperature, humidity, dew point. No API key needed. For San Diego area: station KSAN or nearby. |
| **USGS 3DEP Elevation** | `elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage` | One-time fetch | DEM heightmap for terrain mesh generation. Request as GeoTIFF or PNG heightmap. |
| **LANDFIRE Fuel** | `landfire.gov` data download or LANDFIRE WMS tiles | One-time fetch (pre-bake) | FBFM40 fuel model classification per 30m pixel. Maps to Rothermel fuel parameters. Pre-download for your demo area and bake into the CA grid. |
| **Red Flag Warnings** | `api.weather.gov/alerts/active?area=CA` | Poll every 10 min | Active fire weather watches/warnings for the region. Display on Weather Panel. |

**FIRMS API key:** Free — register at `firms.modaps.eosdis.nasa.gov/api/` for a MAP_KEY. Provides up to 1000 transactions/day.

**Data flow:** Backend polls APIs on intervals → normalizes into a unified state object → pushes to frontend via WebSocket or SSE → frontend updates terrain overlays, panels, and AI context.

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **AR Runtime** | Meta Quest 3 + Meta Quest Browser | Best WebXR support: passthrough, plane detection, hand tracking, anchors. No app store needed — just a URL. |
| **3D Engine** | Three.js r168+ | WebXR integration, shader flexibility, massive ecosystem. You know it from Fire Force. |
| **AR Utilities** | Reality Accelerator Toolkit (RATK) | Meta's official Three.js bindings for plane detection, anchors, hit-test. Handles the hard parts of MR. |
| **Terrain Tiles** | USGS 3DEP + Mapbox satellite tiles (or Google Photorealistic 3D Tiles via 3DTilesRendererJS) | Heightmap + texture for terrain mesh. |
| **UI in AR** | three-mesh-ui or HTML→Canvas→Texture | Floating panels with text, charts, video feeds. |
| **Fire Simulation** | Custom JS cellular automata (Rothermel-based) | Runs client-side for instant feedback. 128×128 grid at 10fps is ~1.6M cell evaluations/sec — fine for Quest 3. |
| **Backend** | Node.js + Express | API aggregation, AI orchestration, WebSocket hub. |
| **Real-time Comms** | WebSocket (socket.io) + SSE | Bidirectional: voice commands up, state updates down. |
| **AI Engine** | Google Gemini 2.5 Flash | Fast inference, long context window for full state injection, multimodal. |
| **Voice Input** | Web Speech API (SpeechRecognition) | Built into Quest Browser. Free. Works offline for basic recognition. |
| **Voice Output** | ElevenLabs API (or Web SpeechSynthesis fallback) | Natural-sounding AI advisor voice. |
| **Frontend Build** | Vite + vanilla JS (or React if preferred) | Fast dev server, HTTPS for WebXR (use `vite --https`). |

---

## Project Structure

```
marshal-management/
├── client/
│   ├── index.html
│   ├── src/
│   │   ├── main.js              # Entry: init Three.js, WebXR session
│   │   ├── terrain/
│   │   │   ├── TerrainLoader.js  # Load DEM → PlaneGeometry
│   │   │   ├── TerrainMesh.js    # Satellite texture draping
│   │   │   └── TerrainAnchor.js  # RATK table anchoring
│   │   ├── fire/
│   │   │   ├── CellularAutomata.js  # Rothermel CA engine
│   │   │   ├── FireOverlay.js       # Shader-based fire visualization
│   │   │   ├── FuelGrid.js          # LANDFIRE fuel type mapping
│   │   │   └── Interventions.js     # Water drop, retardant, firebreak
│   │   ├── panels/
│   │   │   ├── PanelManager.js    # Create/position floating panels
│   │   │   ├── WeatherPanel.js
│   │   │   ├── FireStatusPanel.js
│   │   │   ├── ResourcePanel.js
│   │   │   ├── VideoFeedPanel.js
│   │   │   ├── AIAdvisorPanel.js
│   │   │   └── CommsPanel.js
│   │   ├── interaction/
│   │   │   ├── HandTracking.js    # WebXR hand input processing
│   │   │   ├── GestureDetector.js # Pinch, grab, point detection
│   │   │   ├── ToolPalette.js     # Floating tool selector
│   │   │   └── VoiceInput.js      # Web Speech API wrapper
│   │   ├── ar/
│   │   │   ├── ARSession.js       # WebXR session management
│   │   │   ├── PlaneDetection.js  # RATK plane detection
│   │   │   └── AnchorManager.js   # Persistent anchor handling
│   │   └── network/
│   │       ├── DataSync.js        # WebSocket client
│   │       └── APIClient.js       # REST calls to backend
│   ├── assets/
│   │   ├── heightmaps/            # Pre-baked DEM tiles
│   │   ├── textures/              # Satellite imagery, fire shader textures
│   │   └── fuel-maps/             # Pre-baked LANDFIRE grids
│   └── vite.config.js
├── server/
│   ├── index.js                   # Express + WebSocket server
│   ├── routes/
│   │   ├── weather.js             # NWS API proxy + caching
│   │   ├── fire-data.js           # FIRMS API proxy
│   │   └── ai.js                  # Gemini AI advisor endpoint
│   ├── services/
│   │   ├── WeatherService.js      # Poll NWS, cache, normalize
│   │   ├── FIRMSService.js        # Poll FIRMS, parse CSV
│   │   ├── AIAdvisor.js           # Gemini prompt assembly + inference
│   │   └── StateManager.js        # Unified state object
│   └── package.json
├── data/
│   ├── fuel-models.json           # Rothermel fuel type parameters
│   └── demo-scenarios/            # Pre-built fire scenarios for demo
└── README.md
```

---

## Hackathon Build Order (24-hour sprint)

### Phase 1: Foundation (Hours 0–6)

**Goal:** 3D terrain visible on table through Quest 3.

1. Scaffold Vite project with Three.js. Get a basic WebXR `immersive-ar` session running with passthrough. Verify on Quest 3.
2. Load a pre-baked heightmap (start with a small test DEM — even a 64×64 synthetic one). Create `PlaneGeometry`, displace vertices, apply a satellite texture.
3. Integrate RATK. Detect the table plane, create an anchor, parent the terrain to it. At end of Phase 1, you should see a miniature terrain floating on your physical table.

### Phase 2: Fire Simulation (Hours 6–12)

**Goal:** Fire spreads on the terrain. You can click/pinch to ignite.

4. Build the cellular automata engine. Start with a simple 128×128 grid. Implement basic spread (8-neighbor, uniform speed). Get the fire overlay rendering on the terrain (red texture).
5. Add Rothermel physics: fuel type lookup, wind factor, slope factor. Load pre-baked LANDFIRE fuel data for your demo area. Fire should now spread faster uphill and downwind.
6. Build the timeline scrubber (floating AR slider). Pre-compute 3 hours of spread. Scrubbing changes the overlay.
7. Implement water drop intervention. Pinch on terrain → suppression zone → fire reacts.

### Phase 3: Data & Panels (Hours 12–18)

**Goal:** Live data flowing, panels visible, AI advisor talking.

8. Stand up the Express backend. Implement NWS weather polling (no API key needed — just hit `api.weather.gov`). Proxy to frontend via WebSocket.
9. Build floating AR panels: Weather (wind arrow + data), Fire Status (computed from CA), Resource Tracker (mock data with icons on terrain).
10. Wire up FIRMS data (requires free API key registration). Parse CSV response, use hotspot lat/longs to seed CA ignition points.
11. Implement AI Advisor: Gemini 2.5 Flash integration. Build the context assembly pipeline. Get a basic Q&A working ("What's my biggest risk right now?").

### Phase 4: Polish & Demo (Hours 18–24)

**Goal:** Demo-ready. Wow factor.

12. Voice interaction: Web Speech API for commands. Wake-word or push-to-talk. AI responds via TTS.
13. Proactive AI mode: auto-analyze every 60s, push warnings.
14. Visual polish: fire shader glow/pulse, water drop splash particles, panel glass-morphism, smooth hand interaction feedback.
15. Build 2–3 demo scenarios with pre-seeded fire positions for a compelling narrative walkthrough.
16. Record backup demo video in case of hardware issues.

---

## Differentiation from FireSight

| FireSight | Marshal Management |
|---|---|
| VR-only (isolated environment) | AR passthrough (see your real surroundings) |
| Full-screen immersive scene | Tabletop miniature — the map IS a physical object on your table |
| PICO headset | Meta Quest 3 (wider WebXR support, better passthrough) |
| 4 named AI agents (Pyro, Swarm, Evac, Deploy) | Single unified AI advisor with full-context synthesis |
| 45-agent ICS hierarchy simulation | Focus on the marshal's direct tactical decisions |
| Separate Telegram bot interface | Voice-first with hand gesture interaction, no external devices needed |
| Fire overlays on terrain (similar) | Interactive interventions — drop water, draw containment lines, see simulation react in 3D |
| 2D map + 3D drone view | Single coherent AR workspace with spatial panels |

**Your key differentiator:** The tabletop metaphor. Fire marshals already use physical sand tables and paper maps. This is the digital-physical hybrid that maps to their existing mental model, but supercharged with live data and AI. You're not replacing the war room — you're upgrading it.

---

## Demo Script (3-minute pitch)

1. **Open:** "The Incident Command System hasn't changed since the 1970s. Fire marshals coordinate with radios and paper maps while AI can predict fire spread from satellite data in real-time. What if we brought those worlds together?" (15s)

2. **Put on headset.** Look at table. Terrain materializes. "Marshal Management turns any surface into a living tactical map." (10s)

3. **Show fire spreading.** "This is a Rothermel cellular automata simulation — the same physics the US Forest Service uses — running on real LANDFIRE fuel data and live wind conditions from NOAA." Point to the Weather Panel showing live NWS data. (20s)

4. **Interact.** Scrub the timeline forward — "Watch: in 2 hours, the fire reaches this ridge." Scrub back. "But if I drop retardant here..." — pinch to place a water drop — fire contours shift around it. "...we buy 45 minutes." (30s)

5. **Talk to AI.** "Marshal AI, what's my best containment strategy if wind shifts northwest?" AI responds with specific recommendations. Highlight zone pulses on terrain. (30s)

6. **Show panels.** Glance at video feeds, resource tracker, fire status. "Everything a marshal needs — weather, resources, field cameras, AI analysis — in spatial panels they can arrange around their workspace." (20s)

7. **Close:** "This isn't a mockup. It's real terrain from USGS, real weather from NOAA, real fire physics from Rothermel, and real AI synthesis from Gemini. Marshal Management: the war room, everywhere." (15s)

---

## API Keys & Accounts to Set Up Before the Hackathon

| Service | What You Need | Where |
|---|---|---|
| NASA FIRMS | Free MAP_KEY | `firms.modaps.eosdis.nasa.gov/api/` |
| Google Gemini | API key (free tier) | `ai.google.dev` |
| Google Maps Tiles (optional) | API key + billing | `console.cloud.google.com` → enable Map Tiles API |
| ElevenLabs (optional) | API key (free tier = 10k chars/month) | `elevenlabs.io` |
| Mapbox (optional, for satellite texture tiles) | Free tier token | `mapbox.com` |
| OpenTopography (for DEM) | Free API key | `opentopography.org` |

---

## Pre-Hackathon Data Prep

Do this the night before:

1. **Pick your demo area.** The Palisades Fire zone (LA) is compelling and well-documented. Alternatively, pick a San Diego County area (locally relevant to UCSD hackathon — the 2003 Cedar Fire zone or 2007 Witch Creek Fire area).

2. **Download DEM heightmap.** Use OpenTopography API or USGS National Map to grab a 10m GeoTIFF for your demo area (~5km × 5km). Convert to a PNG heightmap using GDAL: `gdal_translate -of PNG -ot Byte -scale input.tif heightmap.png`

3. **Download satellite texture.** Grab a Mapbox satellite tile or Google Earth screenshot of the same area. Align it to the DEM bounds.

4. **Download LANDFIRE fuel data.** Go to `landfire.gov/viewer`, select FBFM40 (Fire Behavior Fuel Model 40), download for your area. Convert the GeoTIFF to a simplified JSON grid mapping each cell to one of 5 fuel types.

5. **Find your nearest NWS station ID.** For San Diego: KSAN (San Diego International). For LA/Palisades: KLAX or KSMO. Test the API: `curl https://api.weather.gov/stations/KSAN/observations/latest`

6. **Register FIRMS API key** and test: `curl "https://firms.modaps.eosdis.nasa.gov/api/area/csv/YOUR_KEY/VIIRS_NOAA20_NRT/-118.6,34.0,-118.4,34.2/1"`

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| Quest 3 WebXR passthrough doesn't work at venue | Have a desktop Three.js fallback (no AR, just 3D scene in browser). Same code, just skip the XR session. |
| RATK plane detection is unreliable in bright lighting | Fallback: place terrain at fixed position in front of user (no table detection, just floating in space). |
| API rate limits during demo | Cache all API responses. Pre-fetch before the demo. The fire sim runs entirely client-side so it works offline. |
| Voice recognition fails in loud hackathon | Add a floating text-command panel (type commands). Or use hand gesture shortcuts for key actions. |
| Fire simulation is too slow on Quest 3 | Reduce grid to 64×64. Run simulation at 5fps instead of 10. Pre-compute projections. |
| Google 3D Tiles API is too complex to integrate in time | Use the heightmap approach (Option A). It's simpler and you have full control over the mesh for fire overlay raycasting. |

---

## Stretch Goals (if time permits)

- **Multi-user:** Second Quest 3 sees the same terrain + fire state via WebSocket sync. Two marshals collaborating on the same tabletop.
- **Evacuation routing:** Dijkstra on road network data (OpenStreetMap) with fire-blocked roads removed. Green/red route overlay on terrain.
- **Drone dispatch simulation:** Tap to "send a drone" — icon flies from staging area to target location, mock thermal camera feed appears in a panel.
- **Historical replay:** Load a past fire's FIRMS data and replay it on the terrain as a training exercise.
- **Phone companion:** A simple web dashboard (same backend, 2D view) that a field commander can access from their phone — mirrors the terrain view + fire state as a 2D map with Leaflet/Mapbox.
