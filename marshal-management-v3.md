# Marshal Management — Full Architecture & Build Plan v3

## Reboot the Earth 2026 | UCSD | May 8–9

---

## Vision

A fire marshal puts on a Meta Quest 3. Through passthrough AR, they see their real table — and on it, a living 3D topographic map of the active fire zone. Fire spreads across the terrain in real-time. Floating panels orbit the workspace. To their left sits a physical hardware command board — a tactile control surface with a joystick and buttons. They push the joystick to rotate the map. They hold the push-to-talk button: *"What's the fastest evacuation route for Zone 3 if the wind shifts?"* — the AI responds while road overlays on the terrain update, showing green safe corridors and red blocked roads with animated traffic flow arrows. They press the EVACUATE button — Zone 3 shifts from yellow to red on the map, routes light up, and estimated clearance times appear.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     META QUEST 3 (AR)                     │
│   Three.js + WebXR immersive-ar + RATK                   │
│   ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌───────────┐ │
│   │ 3D Terr. │ │ Fire CA  │ │ Evac Viz  │ │ AR Panels │ │
│   │ on Table │ │ Overlay  │ │ Roads/Zns │ │ (floating)│ │
│   └──────────┘ └──────────┘ └───────────┘ └───────────┘ │
│   ┌──────────┐ ┌──────────┐ ┌───────────┐               │
│   │Hand Track│ │  Voice   │ │ Gestures  │               │
│   └──────────┘ └──────────┘ └───────────┘               │
└─────────────────────┬────────────────────────────────────┘
                      │ WebSocket
              ┌───────┴────────┐
              │  Node Server   │
              │                │
              │ ┌────────────┐ │      USB Serial
              │ │ State Mgr  │ │◄─────────────────┐
              │ ├────────────┤ │                   │
              │ │ AI Advisor │ │          ┌────────┴────────┐
              │ │ (Gemini)   │ │          │  ARDUINO UNO    │
              │ ├────────────┤ │          │  Hardware Board  │
              │ │ Evac Engine│ │          │                  │
              │ │ (routing)  │ │          │ • Joystick       │
              │ ├────────────┤ │          │ • Push-to-Talk   │
              │ │ API Proxy  │ │          │ • Panel toggles  │
              │ └────────────┘ │          │ • Evac trigger   │
              └───────┬────────┘          │ • Mode switch    │
                      │                   │ • Reset          │
       ┌──────────────┼──────────┐        └─────────────────┘
       │              │          │
  ┌────┴────┐  ┌──────┴───┐ ┌───┴──────┐
  │NASA     │  │NWS       │ │LANDFIRE  │
  │FIRMS    │  │Weather   │ │Fuel +    │
  │Hotspots │  │Wind/Temp │ │OSM Roads │
  └─────────┘  └──────────┘ └──────────┘
```

---

## Feature Set

### Feature 1: AR Tabletop Terrain Map

A photorealistic 3D terrain model anchored to the marshal's physical table via WebXR plane detection. Real elevation data (USGS 3DEP), real satellite imagery, real topographic features. Walk around it, lean in to inspect ridgelines. Joystick on hardware board rotates and pans the view.

**Tech:** Three.js + WebXR `immersive-ar` + Reality Accelerator Toolkit (RATK) for plane detection and anchoring. Heightmap-displaced `PlaneGeometry` with satellite texture drape. RATK detects horizontal table surface, creates anchor, parents terrain Group to it.

### Feature 2: Live Fire Spread Simulation

Rothermel cellular automata running on the terrain. Fire spreads based on real fuel types (LANDFIRE FBFM40), real wind data (NOAA NWS), and real slope (derived from DEM). Visual: red = burning now, orange = 30-min projection, yellow = 1-hour projection. Timeline scrubber lets the marshal slide forward in time.

**Tech:** 128×128 CA grid with simplified Rothermel rate-of-spread formula. Five fuel classes (chaparral, grass, timber, urban, rock). Wind and slope factors. Ember spotting probability. Rendered as animated shader overlay on terrain mesh.

### Feature 3: Evacuation Planning System

**The crown jewel.** A sophisticated, data-driven evacuation planning engine that operates directly on the 3D terrain map. A real graph-based routing system that accounts for road network topology, road capacity, fire movement, population density, and time pressure. The marshal can designate zones, trigger evacuations, mark roads as blocked, and watch the system dynamically reroute — all visualized in 3D on the tabletop.

*(Full technical breakdown in dedicated section below.)*

### Feature 4: Floating AR Information Panels

Spatial panels orbiting the workspace — spawned and dismissed via hardware board buttons. Each panel can be grabbed and repositioned via hand tracking. Rendered as Canvas textures on Three.js planes with glass-morphism effect.

**Active panels:**

| Panel | Content | Data Source |
|-------|---------|-------------|
| **Weather** | Wind speed/direction (animated arrow), temperature, humidity, gusts, Red Flag warnings | NWS API (`api.weather.gov`) |
| **Evacuation Dashboard** | Zone statuses, evacuation %, clearance times, bottlenecks, shelter capacity | Evacuation Engine |
| **AI Advisor** | Scrolling recommendation feed, AI's latest analysis, warnings, suggestions | Gemini 2.5 Flash |
| **Video Feeds** | 2–4 simulated live video feeds from field cameras | Local video / mock |

### Feature 5: AI Strategic Advisor

A unified AI co-pilot (Gemini 2.5 Flash) that has access to ALL data — fire state, weather, terrain, road network, population, evacuation status. The marshal holds the push-to-talk button on the hardware board and speaks. The AI responds with data-driven recommendations and can trigger visual overlays on the terrain. Proactive mode: auto-analyzes every 60 seconds and pushes warnings.

### Feature 6: Voice + Hand + Hardware Control

Three input modalities converging on one state: hand tracking and gestures for spatial interaction in AR, voice for natural language commands to the AI, and the physical hardware board for tactile, eyes-free control of system functions.

### Feature 7: Live Data Feeds

NASA FIRMS (real fire hotspots), NOAA/NWS (real wind and weather), USGS 3DEP (real terrain elevation), LANDFIRE (real fuel classification), OpenStreetMap (real road network), US Census (real population density).

---

## Hardware Control Board — Full Design

### Communication Architecture

```
Arduino UNO ──USB Serial @ 115200 baud──► Node.js Server (serialport library)
                                              │
                                              ▼
                                         State Manager
                                              │
                                              ▼
                                     WebSocket broadcast
                                              │
                                              ▼
                                      Quest 3 AR Client
```

The Arduino reads all inputs and sends a compact message at ~30Hz. The Node.js server parses via the `serialport` npm package and maps inputs to state mutations, which broadcast via WebSocket to the Quest client.

### Control Layout

```
┌─────────────────────────────────────────────────────────┐
│                   MARSHAL COMMAND BOARD                   │
│                                                           │
│   ┌─────────┐                                            │
│   │         │  [WEATHER]  [EVAC]  [AI]  [VIDEO]          │
│   │ JOYSTICK│                                            │
│   │  (map   │  [PUSH-TO-TALK ═══════════════════]        │
│   │ rotate) │                                            │
│   │         │  [EVACUATE 🔴]       [RESET]               │
│   └─────────┘                                            │
│                                                           │
│   ┌───────────────────┐                                  │
│   │  MODE SWITCH      │                                  │
│   │  MONITOR/COMMAND/ │                                  │
│   │  EVACUATE         │                                  │
│   └───────────────────┘                                  │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

### Button Inventory & Functions

| Control | Hardware Component | Arduino Pin | Function |
|---|---|---|---|
| **Joystick** | 2-axis analog joystick module | A0 (X), A1 (Y), D2 (click) | Rotate and pan the 3D terrain map on the table. Click = reset to default view. |
| **Push-to-Talk** | Large tactile button (momentary) | D3 | Hold to activate voice input to AI advisor. Quest mic activates. |
| **Weather Panel** | Tactile push button | D4 | Toggle the Weather/Wind floating panel on/off in AR space. |
| **Evac Status Panel** | Tactile push button | D5 | Toggle the Evacuation Dashboard panel on/off. |
| **AI Advisor Panel** | Tactile push button | D6 | Toggle the AI Advisor feed panel on/off. |
| **Video Feeds Panel** | Tactile push button | D7 | Toggle the Video Feeds panel on/off. |
| **EVACUATE** | Large red push button | D8 | Master evacuation trigger. Runs the evacuation engine for all active zones. |
| **Mode Switch** | 3-position toggle switch | D9, D10 | MONITOR (passive observation) / COMMAND (active mode, can mark roads, designate zones) / EVACUATE (evacuation planning focus, evac tools foregrounded). |
| **Reset Scenario** | Recessed push button | D11 | Resets the fire simulation and evacuation state. Recessed to prevent accidental press. |

**Total: 9 controls. 4 analog pins used, 10 digital pins used.**

### Arduino Code Structure

```cpp
void loop() {
  int jx = analogRead(A0);
  int jy = analogRead(A1);

  // Read digital buttons (with debounce)
  int ptt       = digitalRead(3);
  int panelWx   = digitalRead(4);
  int panelEvac = digitalRead(5);
  int panelAI   = digitalRead(6);
  int panelVid  = digitalRead(7);
  int evacuate  = digitalRead(8);
  int modeA     = digitalRead(9);
  int modeB     = digitalRead(10);
  int reset     = digitalRead(11);
  int jClick    = digitalRead(2);

  // Send compact CSV
  Serial.print(jx); Serial.print(',');
  Serial.print(jy); Serial.print(',');
  Serial.print(ptt); Serial.print(',');
  Serial.print(panelWx); Serial.print(',');
  Serial.print(panelEvac); Serial.print(',');
  Serial.print(panelAI); Serial.print(',');
  Serial.print(panelVid); Serial.print(',');
  Serial.print(evacuate); Serial.print(',');
  Serial.print(modeA); Serial.print(',');
  Serial.print(modeB); Serial.print(',');
  Serial.print(reset); Serial.print(',');
  Serial.println(jClick);

  delay(33); // ~30Hz
}
```

Node.js server parsing:

```javascript
const { SerialPort, ReadlineParser } = require('serialport');
const port = new SerialPort({ path: '/dev/ttyACM0', baudRate: 115200 });
const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

parser.on('data', (line) => {
  const [jx, jy, ptt, wx, evac, ai, vid, evacuate, mA, mB, reset, jClick] = 
    line.trim().split(',').map(Number);

  // Joystick → map rotation
  if (Math.abs(jx - 512) > 50 || Math.abs(jy - 512) > 50) {
    io.to('quest').emit('map_rotate', {
      dx: (jx - 512) / 512,
      dy: (jy - 512) / 512
    });
  }

  // Button edge detection (compare to previous state)
  if (risingEdge('evacuate', evacuate)) {
    evacuationEngine.triggerEvacuation();
  }
  if (ptt !== prevState.ptt) {
    io.to('quest').emit('ptt_active', ptt === 1);
  }
  // Panel toggles on rising edge
  if (risingEdge('wx', wx)) io.to('quest').emit('toggle_panel', 'weather');
  if (risingEdge('evac', evac)) io.to('quest').emit('toggle_panel', 'evacuation');
  if (risingEdge('ai', ai)) io.to('quest').emit('toggle_panel', 'advisor');
  if (risingEdge('vid', vid)) io.to('quest').emit('toggle_panel', 'video');
});
```

### Parts List

- 1× Arduino UNO (you have this)
- 1× Analog joystick module (2-axis + button)
- 6× Tactile push buttons (4 panel toggles + reset + PTT)
- 1× Large red push button (EVACUATE)
- 1× 3-position toggle switch (or 2× SPST switches)
- 6× 10kΩ pull-down resistors (for buttons without internal pullups)
- Breadboard or perfboard
- Jumper wires
- Enclosure (cardboard box works)
- USB cable (Arduino to laptop)

---

## Evacuation Planning System — Full Technical Design

### Overview

The evacuation system is a **time-aware, capacity-constrained, fire-coupled graph routing engine** that operates on real road network data and real population distribution. It accounts for the fact that roads have finite throughput, that fire is moving and will block roads that are currently open, and that some populations need more time to evacuate than others.

### Data Sources

| Data | Source | Format | Resolution |
|---|---|---|---|
| **Road Network** | OpenStreetMap via OSMnx (Python) | NetworkX graph → exported as GeoJSON | Individual road segments with lane count, road type, speed limit |
| **Population Density** | US Census Bureau ACS 5-year estimates | Census block group level | ~600–3000 people per block group, mapped to lat/lng centroids |
| **Fire Prediction** | The CA fire simulation (Feature 2) | 128×128 grid with time-of-arrival per cell | Provides "when will fire reach this location" for every point |
| **Terrain/Elevation** | USGS 3DEP (same DEM as terrain map) | Raster heightmap | Affects road travel time (steep roads = slower evacuation) |
| **Safe Destinations** | Pre-designated + dynamically set | Point locations with capacity | Shelters, schools, staging areas outside fire zone |
| **Real-time Weather** | NWS API | Wind speed/direction, Red Flag warnings | Affects fire projection which affects road viability |

### Pre-Processing Pipeline (run before hackathon)

Python script that prepares road and population data for the demo area (2003 Cedar Fire zone, San Diego County):

```python
import osmnx as ox
import networkx as nx
import json

# 1. Download road network for Cedar Fire demo area
G = ox.graph_from_bbox(north, south, east, west, network_type='drive')

# 2. Add edge attributes: travel time, capacity
for u, v, data in G.edges(data=True):
    highway = data.get('highway', 'residential')
    lanes = LANE_LOOKUP.get(highway, 1)
    speed_kph = data.get('maxspeed', SPEED_LOOKUP.get(highway, 40))
    length_m = data.get('length', 100)

    data['travel_time_min'] = (length_m / 1000) / (speed_kph / 60)
    data['capacity_veh_hr'] = lanes * 1800  # ~1800 veh/hr/lane
    data['lanes'] = lanes
    data['blocked'] = False

# 3. Export for JavaScript consumption
nodes = [{'id': n, 'lat': d['y'], 'lng': d['x']}
         for n, d in G.nodes(data=True)]

edges = [{'source': u, 'target': v,
          'travel_time': d['travel_time_min'],
          'capacity': d['capacity_veh_hr'],
          'lanes': d['lanes'],
          'coords': list(d['geometry'].coords) if 'geometry' in d else None}
         for u, v, d in G.edges(data=True)]

with open('road_network.json', 'w') as f:
    json.dump({'nodes': nodes, 'edges': edges}, f)
```

**Road capacity lookup table:**

| Road Type (OSM `highway` tag) | Lanes (typical) | Capacity (veh/hr/lane) | Evacuation Speed (km/h) |
|---|---|---|---|
| `motorway` | 3–4 | 2000 | 80 |
| `trunk` | 2–3 | 1800 | 65 |
| `primary` | 2 | 1600 | 50 |
| `secondary` | 2 | 1400 | 40 |
| `tertiary` | 1–2 | 1200 | 35 |
| `residential` | 1 | 800 | 25 |
| `unclassified` | 1 | 600 | 20 |

Evacuation speeds are significantly lower than normal due to congestion, panic, contra-flow, and debris.

### Evacuation Zone System

Uses the standard **Ready / Set / Go** three-level framework used across California:

```
For each populated area, compute:
  T_fire = time until fire arrival (from CA simulation)
  T_evac = time needed to fully evacuate (from routing)
  Safety_margin = T_fire - T_evac

LEVEL 1 — READY (Blue)
  T_fire > 120 min
  "Be aware. Review your evacuation plan."
  Roads shown as: thin blue lines

LEVEL 2 — SET (Yellow)
  60 min < T_fire ≤ 120 min
  "Significant danger. Prepare to leave immediately."
  Roads shown as: medium yellow lines, routes highlighted
  Vulnerable populations (elderly, medical) → GO NOW

LEVEL 3 — GO (Red)
  T_fire ≤ 60 min  OR  Safety_margin < 15 min
  "Immediate threat. Evacuate NOW."
  Roads shown as: thick red animated arrows with flow direction
  Active routing guidance, estimated clearance times

BLOCKED (Black)
  T_fire = 0 (fire has arrived) OR road is impassable
  Roads shown as: black dashed lines with X markers
```

### Core Routing Algorithm

The evacuation engine runs server-side (Node.js) and uses a **time-expanded, capacity-aware Dijkstra** approach:

**Step 1 — Fire-Time Overlay:** Query the CA fire simulation for time-of-arrival at every road node. Any road segment where fire arrives before the evacuation wave passes through is marked as blocked at that future time.

**Step 2 — Dynamic Graph Construction:** For each time step (5-minute intervals), build a version of the road graph where edges that will be fire-blocked by that time are removed or heavily penalized.

**Step 3 — Population Assignment:** Each Census block group's population is assigned to the nearest road network node as a "demand" value. Pre-designated shelters/safe areas are marked as "supply" nodes with capacity limits (e.g., a school = 500 people, a stadium = 5000).

**Step 4 — Multi-Source Dijkstra with Capacity:** Run modified Dijkstra from every demand node simultaneously to find shortest paths to supply nodes. When an edge's cumulative assigned traffic exceeds its hourly capacity, that edge's effective travel time increases (congestion penalty):

```
effective_time = base_time × (1 + α × (flow / capacity)^β)

where:
  α = 0.15 (BPR congestion parameter)
  β = 4.0 (BPR exponent)
  flow = vehicles assigned to this edge in this time window
  capacity = edge capacity in vehicles/hour
```

This is the Bureau of Public Roads (BPR) function — the standard traffic engineering congestion model.

**Step 5 — Route Assignment:** For each zone, output:
- Primary evacuation route (green overlay on map)
- Secondary/alternate route (dashed green)
- Estimated clearance time (how long until the zone is fully evacuated)
- Bottleneck locations (edges where flow/capacity > 0.8, highlighted in orange)
- Contraflow recommendation (if a 2-lane road could be converted to 2 outbound lanes)

**Step 6 — Continuous Re-evaluation:** The evacuation plan re-runs every time the fire simulation advances or the marshal marks a road as blocked. Routes may change. Zones may escalate.

### What the AI Advisor Knows About Evacuation

The AI gets injected with the full evacuation context:

```
EVACUATION STATE:
- Zone A (Scripps Ranch): LEVEL 3 GO — 3,200 residents — Primary route:
  Scripps Poway Pkwy → I-15 South — Est. clearance: 50 min —
  BOTTLENECK at Scripps Poway/I-15 on-ramp (92% capacity)
- Zone B (Poway): LEVEL 2 SET — 2,100 residents — Fire arrival:
  90 min — Evacuation time needed: 55 min — Safety margin: 35 min
- Zone C (Ramona): LEVEL 1 READY — 4,800 residents — Fire arrival:
  170 min

ROAD NETWORK STATUS:
- SR-67 BLOCKED north of Lakeside (fire crossed 15 min ago)
- I-15 southbound congested (flow at 88% capacity)
- Poway Rd clear but fire arrival in 65 min

CRITICAL WARNINGS:
- Zone B safety margin declining: was 50 min → now 35 min (wind shift)
- Recommend upgrading Zone B to LEVEL 3 GO within next 10 min
- Contraflow recommended on Poway Rd (convert eastbound to westbound)
```

The AI can answer questions like:
- *"What happens if we lose I-15?"* → re-route analysis
- *"How many people are still in Zone A?"* → population tracking
- *"Should I trigger evacuation for Zone B now?"* → risk-based recommendation
- *"Where are the bottlenecks?"* → specific intersection identification with suggestions

### Visual Rendering on the 3D Map

Roads render as 3D line geometries (Three.js `Line2` from three/examples for fat lines) projected onto the terrain surface:

| Element | Visual |
|---|---|
| **Clear road** | Thin green line on terrain |
| **Evacuation route (active)** | Thick bright green line with animated arrow particles flowing in evacuation direction |
| **Congested road** | Yellow/orange line, thickness proportional to congestion level |
| **Blocked road (fire)** | Red line with pulsing X markers at blocked points |
| **Destroyed road** | Black dashed line |
| **Zone boundary** | Semi-transparent colored polygon draped on terrain (blue/yellow/red) |
| **Safe destination** | Green diamond icon with capacity bar (fills as people are assigned) |
| **Population cluster** | Small white dots clustered at block group centroids, animate along routes when GO is triggered |
| **Bottleneck** | Orange pulsing circle at the congested intersection |
| **Contraflow recommendation** | Bi-directional arrows flip to single-direction on the recommended segment |

### Evacuation Dashboard Panel (floating AR)

Spawned via the EVAC button on the hardware board:

```
┌─────────────────────────────────────────┐
│         EVACUATION STATUS               │
├─────────────────────────────────────────┤
│                                         │
│  ZONE A — Scripps Ranch                 │
│  ██████████████████ LEVEL 3 GO          │
│  Pop: 3,200  |  Evacuated: 1,540 (48%) │
│  Est. clearance: 35 min remaining       │
│  Primary: Scripps Poway → I-15 South    │
│  ⚠ BOTTLENECK: Scripps/I-15 ramp (92%) │
│                                         │
│  ZONE B — Poway                         │
│  ████████████░░░░░░ LEVEL 2 SET         │
│  Pop: 2,100  |  Fire ETA: 90 min        │
│  Safety margin: 35 min ▼ (declining)    │
│  Route: Poway Rd → I-15 South           │
│  AI: "Recommend upgrade to GO in 10min" │
│                                         │
│  ZONE C — Ramona                        │
│  ████░░░░░░░░░░░░░░ LEVEL 1 READY      │
│  Pop: 4,800  |  Fire ETA: 170 min       │
│  Safety margin: 115 min (stable)        │
│                                         │
│  SHELTERS              Capacity         │
│  Alliant Univ.         450/800   ███▓░  │
│  Poway HS              280/600   ██░░░  │
│  Qualcomm Stadium      800/8000  █░░░░  │
│                                         │
│  TOTAL: 10,100 people | 38% evacuated   │
│  Network: 2 bottlenecks | 1 road lost   │
└─────────────────────────────────────────┘
```

### Evacuation Tools Available to the Marshal

| Tool | Activated By | What It Does |
|---|---|---|
| **Zone Designation** | Hand-draw a boundary on terrain in COMMAND mode, or let AI auto-designate based on fire prediction | Defines a named zone with population count. Auto-assigns evacuation level based on fire ETA. |
| **Manual Level Override** | Voice command: "Upgrade Zone B to Go" | Marshal can override the automated level based on field intel. |
| **Road Block** | Pinch a road on the map in COMMAND mode → "Mark as blocked" | Manually mark a road as impassable (downed power lines, debris, accident). Routing immediately reroutes. |
| **Contraflow Toggle** | Voice command: "Enable contraflow on Poway Road" | Doubles outbound capacity on a road by converting all lanes to evacuation direction. |
| **Add Shelter** | Voice command: "Designate Poway High School as shelter, capacity 600" | Adds a new safe destination. Routing rebalances. |
| **What-If Scenario** | Voice: "What if we lose I-15?" | AI + routing engine computes alternate plans without that road. Overlay shows diff. |
| **Time Projection** | Timeline scrubber (hand interaction) | Shows evacuation progress at future time. |

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **AR Runtime** | Meta Quest 3 + Quest Browser | WebXR passthrough AR |
| **3D Engine** | Three.js r168+ | Terrain, fire, roads, panels |
| **AR Framework** | Reality Accelerator Toolkit (RATK) | Plane detection, anchors, hand tracking |
| **Fire Simulation** | Custom JS cellular automata (Rothermel) | Client-side fire spread |
| **Evacuation Engine** | Custom JS graph router (server-side) | Modified Dijkstra with BPR congestion |
| **Road Data** | OpenStreetMap via OSMnx (pre-processed) | Road network with lanes, speed, geometry |
| **Population Data** | US Census ACS block group (pre-processed) | Population counts mapped to road nodes |
| **Backend** | Node.js + Express + socket.io | State management, API proxy, AI, Arduino serial |
| **Hardware I/O** | Arduino UNO + `serialport` npm | Physical control board via USB serial |
| **AI Engine** | Google Gemini 2.5 Flash | Strategic advisor with full context injection |
| **Voice Input** | Web Speech API (Quest Browser) | Triggered by hardware PTT button |
| **Voice Output** | ElevenLabs API / Web SpeechSynthesis | AI advisor spoken responses |
| **Weather API** | NWS `api.weather.gov` (no key needed) | Live wind, temp, humidity, Red Flag warnings |
| **Fire Hotspots** | NASA FIRMS API (free key) | Real active fire detections |
| **Terrain** | USGS 3DEP (pre-baked DEM) | Elevation heightmap |
| **Fuel Data** | LANDFIRE FBFM40 (pre-baked) | Fuel type classification |
| **Frontend Build** | Vite + vanilla JS | Fast dev server, HTTPS for WebXR |

---

## Project Structure

```
marshal-management/
├── client/
│   ├── index.html
│   ├── src/
│   │   ├── main.js
│   │   ├── terrain/
│   │   │   ├── TerrainLoader.js
│   │   │   ├── TerrainMesh.js
│   │   │   └── TerrainAnchor.js
│   │   ├── fire/
│   │   │   ├── CellularAutomata.js
│   │   │   ├── FireOverlay.js
│   │   │   └── FuelGrid.js
│   │   ├── evacuation/
│   │   │   ├── RoadRenderer.js
│   │   │   ├── ZoneRenderer.js
│   │   │   ├── RouteAnimator.js
│   │   │   ├── BottleneckMarker.js
│   │   │   ├── ShelterMarker.js
│   │   │   └── PopulationDots.js
│   │   ├── panels/
│   │   │   ├── PanelManager.js
│   │   │   ├── WeatherPanel.js
│   │   │   ├── EvacuationPanel.js
│   │   │   ├── AIAdvisorPanel.js
│   │   │   └── VideoFeedPanel.js
│   │   ├── interaction/
│   │   │   ├── HandTracking.js
│   │   │   ├── GestureDetector.js
│   │   │   └── VoiceInput.js
│   │   ├── ar/
│   │   │   ├── ARSession.js
│   │   │   ├── PlaneDetection.js
│   │   │   └── AnchorManager.js
│   │   └── network/
│   │       └── DataSync.js
│   ├── assets/
│   │   ├── heightmaps/
│   │   ├── textures/
│   │   ├── fuel-maps/
│   │   ├── road-network.json
│   │   └── population-grid.json
│   └── vite.config.js
├── server/
│   ├── index.js
│   ├── services/
│   │   ├── ArduinoService.js
│   │   ├── StateManager.js
│   │   ├── WeatherService.js
│   │   ├── FIRMSService.js
│   │   ├── AIAdvisor.js
│   │   └── EvacuationEngine.js
│   └── package.json
├── preprocessing/
│   ├── download_roads.py
│   ├── download_population.py
│   ├── download_dem.py
│   ├── download_fuel.py
│   └── prepare_all.py
├── arduino/
│   └── marshal_board/
│       └── marshal_board.ino
├── data/
│   ├── fuel-models.json
│   ├── road-capacity-lookup.json
│   └── demo-scenarios/
└── README.md
```

---

## Hackathon Build Order (24-hour sprint)

### Phase 1: Foundation (Hours 0–6)

1. Scaffold Vite + Three.js + WebXR. Get `immersive-ar` passthrough running on Quest 3.
2. Load pre-baked heightmap terrain. Anchor to table via RATK.
3. Wire up Arduino board (joystick + PTT + EVACUATE to start). Serial → Node.js → WebSocket → Quest. Joystick rotates the map.

### Phase 2: Fire + Roads (Hours 6–12)

4. Build cellular automata fire simulation. Render fire overlay on terrain.
5. Add Rothermel physics (wind, slope, fuel types).
6. Load pre-processed road network GeoJSON. Render roads as 3D lines on terrain.

### Phase 3: Evacuation Engine (Hours 12–18)

7. Build evacuation routing engine (server-side). Fire-time overlay + dynamic Dijkstra + BPR congestion.
8. Zone designation system. Auto-compute Ready/Set/Go levels from fire ETA.
9. Visual rendering: colored zones on terrain, animated route arrows, bottleneck markers.
10. Wire EVACUATE button to trigger computation. Build Evacuation Dashboard panel.

### Phase 4: AI + Polish (Hours 18–24)

11. Gemini AI integration with full context (fire + evacuation + weather + population).
12. Wire push-to-talk button. Voice I/O working.
13. Evacuation tools: road blocking (pinch in COMMAND mode), contraflow (voice), zone overrides (voice).
14. Polish: fire shader glow, panel glass-morphism, animated population flow dots, remaining panel toggles on board.
15. Build 2–3 demo scenarios based on 2003 Cedar Fire. Record backup demo video.

---

## Demo Script (3-minute pitch)

1. **Open:** "In 2003, the Cedar Fire burned 280,000 acres of San Diego County — the largest fire in California history at the time. 15 people died. Thousands evacuated on gridlocked roads with no coordinated routing." (15s)

2. **Put on headset.** Terrain materializes on table. Pick up the hardware board. "Marshal Management: an AR command center with a physical control board." (10s)

3. **Show fire spreading** across the familiar San Diego terrain. "Real Rothermel physics on real LANDFIRE fuel data, driven by live NOAA wind." (10s)

4. **Press EVACUATE.** Zones light up — blue, yellow, red. Roads animate with green flow arrows. Bottlenecks pulse orange. "The system just computed evacuation routes for 10,000 people across three zones, using real road data from OpenStreetMap, real population from the Census, accounting for road capacity and fire movement." (20s)

5. **Show a problem.** Pinch SR-67 on the map — "Mark as blocked." Routes instantly reroute around it. New bottleneck appears on I-15. "When roads go down, the system replans in real-time." (15s)

6. **Ask the AI.** Hold push-to-talk. "What's my biggest risk right now?" AI responds with specific recommendation about declining safety margins and suggests upgrading a zone. Zone changes color on the map. (25s)

7. **Show the evac dashboard panel** — zone statuses, clearance times, shelter capacity, bottleneck warnings. "Everything a marshal needs to make life-or-death routing decisions." (10s)

8. **Close:** "Real terrain. Real roads. Real population data. Real fire physics. AI that synthesizes it all. And a hardware board you can use without looking at a screen. This is Marshal Management." (15s)

---

## Pre-Hackathon Checklist

### APIs to Register

| Service | URL |
|---|---|
| NASA FIRMS (free MAP_KEY) | `firms.modaps.eosdis.nasa.gov/api/` |
| Google Gemini (API key) | `ai.google.dev` |
| US Census (API key) | `api.census.gov/data/key_signup.html` |
| ElevenLabs (optional) | `elevenlabs.io` |

### Data to Pre-Process

1. **Demo area:** 2003 Cedar Fire zone — Scripps Ranch / Poway / Ramona corridor, San Diego County.
2. **Run `download_roads.py`** — OSMnx road network as GeoJSON.
3. **Run `download_population.py`** — Census block group population.
4. **Download DEM** — USGS 3DEP 10m. Convert to PNG heightmap.
5. **Download satellite texture** for the area.
6. **Download LANDFIRE FBFM40** fuel grid. Simplify to 5-class JSON.
7. **Pre-designate shelters** — Alliant University, Poway HS, Qualcomm Stadium, etc.
8. **Test NWS API** — `curl https://api.weather.gov/stations/KSAN/observations/latest`

### Hardware to Wire Up

Joystick, push-to-talk, 4 panel toggles, EVACUATE button, mode switch, reset button. Upload firmware. Test serial in Arduino Serial Monitor, then test Node.js `serialport` parsing.

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| Quest 3 WebXR issues | Desktop Three.js fallback (same scene, mouse controls) |
| Arduino serial not detected | `serialport` auto-detect. Fallback: keyboard mapped to same events |
| Evacuation routing too slow | Pre-compute for demo scenarios. Cache results. Smaller graph subset |
| Road data too dense | Simplify geometry. Only render roads in terrain bounding box. Hide minor roads when zoomed out |
| Voice fails in loud room | PTT gives clear activation. Fallback: typed commands via laptop keyboard routed through server |
| Fire sim slow on Quest 3 | Reduce to 64×64 grid. 5fps. Pre-compute timeline snapshots |

---

## Stretch Goals

- **Animated population flow:** White dots animate along evacuation routes, accumulate at bottlenecks, arrive at shelters.
- **Multi-user:** Second Quest 3 shares the same state.
- **Historical replay:** Load actual 2003 Cedar Fire FIRMS data and replay on terrain as training.
- **Phone companion:** 2D Leaflet web map mirroring state for field commanders.
- **Sound design:** Ambient radio chatter, alarm sounds when zones escalate, click sounds for hardware buttons.
