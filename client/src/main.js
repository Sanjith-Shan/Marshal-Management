import { io as socketIO } from 'socket.io-client';
import * as THREE from 'three';

import { SceneRoot } from './ar/SceneRoot.js';
import { DesktopControls } from './interaction/DesktopControls.js';
import { ARSession } from './ar/ARSession.js';
import { TerrainMesh } from './terrain/TerrainMesh.js';
import { FireOverlay } from './fire/FireOverlay.js';
import { CellularAutomata } from './fire/CellularAutomata.js';
import { RoadRenderer } from './evacuation/RoadRenderer.js';
import { ZoneRenderer } from './evacuation/ZoneRenderer.js';
import { RouteAnimator } from './evacuation/RouteAnimator.js';
import { BottleneckMarker } from './evacuation/BottleneckMarker.js';
import { ShelterMarker } from './evacuation/ShelterMarker.js';
import { PopulationDots } from './evacuation/PopulationDots.js';
import { ContraflowAnimator } from './evacuation/ContraflowAnimator.js';
import { ProactiveOverlay } from './evacuation/ProactiveOverlay.js';
import { PerimeterOverlay } from './evacuation/PerimeterOverlay.js';
import { CompassMarkers } from './ar/CompassMarkers.js';
import { WindIndicator } from './ar/WindIndicator.js';
import { PanelManager } from './panels/PanelManager.js';
import { VoiceInput } from './interaction/VoiceInput.js';
import { Keybindings } from './interaction/Keybindings.js';
import { HUD } from './ui/HUD.js';

class App {
  constructor() {
    this.canvas = document.getElementById('three-canvas');
    this.socket = socketIO({ path: '/socket.io', transports: ['websocket', 'polling'] });

    this.scenario = null;
    this.snapshot = null;

    // Client-side CA snapshot ring for time-jump rewind. Cadence and depth
    // mirror the server's snapshot ring so a rewind landing on a server snap
    // can find a matching CA snap most of the time.
    this.caRing = [];
    this._lastCaSnapMin = -Infinity;
    this.CA_SNAP_INTERVAL_MIN = 5;
    this.CA_RING_MAX = 24;

    this.scene = new SceneRoot();
    this.terrain = null;
    this.fireCA = null;
    this.fireOverlay = null;
    this.roads = null;
    this.zones = null;
    this.routes = null;
    this.bottlenecks = null;
    this.shelters = null;
    this.populations = null;
    this.contraflow = null;
    this.proactive = null;
    this.compass = null;
    this.windInd = null;
    this.perimeter = null;

    this._currentMode = 'MONITOR';

    this.panels = new PanelManager(this.socket);
    this.voice = new VoiceInput(this.socket);
    this.hud = new HUD(this.socket, this.panels);
    this.keys = new Keybindings(this.socket, this.hud, this.voice, this.panels);
    this.desktop = new DesktopControls(this.scene.camera, this.canvas, this.scene.terrainGroup);
    this.ar = new ARSession(this.scene, this.canvas);

    this._wireSocket();
    this._wireUI();
    this._raf();
  }

  _wireSocket() {
    this.socket.on('connect', () => this.hud.setConnection(true));
    this.socket.on('disconnect', () => this.hud.setConnection(false));

    this.socket.on('scenario', (scn) => {
      console.log('[scenario] received', scn.scenarioName || scn.name, scn.nodes.length + ' nodes', scn.edges.length + ' edges');
      this.scenario = scn;
      this.caRing = [];
      this._lastCaSnapMin = -Infinity;
      this._buildWorld();
      if (scn.scenarioId) this.hud.setScenario(scn.scenarioId);
      this.hud.setScenarioStart(scn.scenarioMeta);
      this.hud.setRealDataBadge(scn);
      this.panels.setScenarioContext(scn);
    });

    this.socket.on('snapshot', (snap) => {
      this.snapshot = snap;
      this.hud.applySnapshot(snap);
      this.panels.applySnapshot(snap);
      this._applyEvacuationToScene(snap);
      if (this.fireCA && snap.weather) this.fireCA.setWind(snap.weather.windDeg, snap.weather.windKph);
      if (this.windInd && snap.weather) this.windInd.setWind(snap.weather.windDeg, snap.weather.windKph, snap.weather.redFlag);
      if (snap.weather) this.hud.setWindStatus(snap.weather);
      if (snap.firms) this.hud.setFirms(snap.firms);
      if (snap.census) this.panels.setCensus(snap.census);
      if (snap.simRunning != null) {
        this.hud.setSimRunning(snap.simRunning);
        if (this.fireCA) this.fireCA.setPaused(!snap.simRunning);
      }
    });

    this.socket.on('tick', ({ simTimeMin }) => {
      this.hud.setSimTime(simTimeMin);
      // Sync fire CA's clock to the server's authoritative sim clock so
      // arrival times stamp with the same minute the user sees in the HUD.
      // The CA still steps locally on its own STEP_INTERVAL; this just
      // anchors the timestamp.
      if (this.fireCA) this.fireCA.simMinutes = simTimeMin;
      this._maybeSnapCA(simTimeMin);
    });

    this.socket.on('time-fast-forward', ({ steps, targetMin }) => {
      if (!this.fireCA) return;
      this.fireCA.fastForward(steps);
      const arrival = this.fireCA.arrivalByNode(this.scenario.nodes);
      const stats = this.fireCA.stats();
      this.socket.emit('time-jump:applied', {
        targetMin,
        arrivalByNode: arrival,
        fire: {
          burningCells: stats.burning,
          perimeterCells: stats.perimeter,
          burnedCells: stats.burned,
          arrivalByNode: arrival
        }
      });
      // Take an immediate CA snapshot at the new time so a follow-up rewind
      // can return here.
      this._maybeSnapCA(targetMin, true);
      if (this.fireOverlay) this.fireOverlay.update(0);
    });

    this.socket.on('time-rewind', ({ targetMin }) => {
      if (!this.fireCA) return;
      const entry = this._findCaSnap(targetMin);
      if (entry) {
        this.fireCA.restore(entry.snap);
      } else {
        // No local snapshot — rebuild a fresh CA. Loses fire state, but the
        // rest of the scene reconciles when the next snapshot broadcast lands.
        this.fireCA = new CellularAutomata(this.scenario);
        if (this.fireOverlay) this.fireOverlay.ca = this.fireCA;
        this._wireFireCAUpdates();
      }
      // After-target snapshots are now alternate futures — discard.
      this.caRing = this.caRing.filter(e => e.simMin <= targetMin);
      this._lastCaSnapMin = entry ? entry.simMin : -Infinity;
      if (this.fireOverlay) this.fireOverlay.update(0);
    });

    this.socket.on('weather', (w) => {
      this.panels.updateWeather(w);
      if (this.fireCA) this.fireCA.setWind(w.windDeg, w.windKph);
      if (this.windInd) this.windInd.setWind(w.windDeg, w.windKph, w.redFlag);
      this.hud.setWindStatus(w);
    });

    this.socket.on('mode', (m) => {
      this.hud.setMode(m);
      this._onModeChange(m);
    });

    this.socket.on('panels', (panels) => this.panels.applyVisibility(panels));

    this.socket.on('evacuation', (ev) => {
      this.snapshot = { ...(this.snapshot || {}), evacuation: ev };
      this.panels.updateEvacuation(ev);
      this._applyEvacuationToScene(this.snapshot);
      if (this._currentMode === 'EVACUATE') {
        this.hud.updateEvacBanner({ ...this.snapshot, populations: this.scenario?.populations });
      }
    });

    this.socket.on('advisor', (msg) => {
      this.panels.appendAdvisor(msg);
      if (this.proactive) this.proactive.notify(msg);
    });

    this.socket.on('firms', (data) => this.hud.setFirms(data));

    this.socket.on('census', (data) => this.panels.setCensus(data));

    this.socket.on('sim', ({ running }) => {
      this.hud.setSimRunning(running);
      if (this.fireCA) this.fireCA.setPaused(!running);
    });
    this.socket.on('fire', (f) => this.hud.setFire(f));

    this.socket.on('edge:update', (u) => {
      if (this.roads) this.roads.applyEdgeUpdate(u);
      // Keep client scenario in sync so the next click toggles instead of re-blocking.
      if (this.scenario?.edges) {
        const e = this.scenario.edges.find(ed => ed.id === u.id);
        if (e) {
          e.blocked = !!u.blocked;
          e.contra = !!u.contra;
        }
      }
    });

    this.socket.on('ptt', (active) => this.hud.setPTT(active));

    this.socket.on('joystick', ({ dx, dy }) => {
      if (this.desktop) this.desktop.pulseRotate(dx, dy);
    });
    this.socket.on('joystick:reset', () => {
      if (this.desktop) this.desktop.resetView();
    });
  }

  _wireUI() {
    document.getElementById('btn-xr').addEventListener('click', () => this.ar.enter());
    this.ar.on('enter', () => {
      document.getElementById('btn-xr').textContent = 'Exit AR';
      document.getElementById('btn-xr').classList.add('active');
    });
    this.ar.on('exit', () => {
      document.getElementById('btn-xr').textContent = 'Enter AR';
      document.getElementById('btn-xr').classList.remove('active');
    });

    this.canvas.addEventListener('click', (ev) => this._handleCanvasClick(ev));
    this.canvas.addEventListener('mousemove', (ev) => this._onCanvasHover(ev));
  }

  _onModeChange(mode) {
    this._currentMode = mode;
    const isEvac = mode === 'EVACUATE';

    // Cursor
    const cursors = { MONITOR: 'default', COMMAND: 'crosshair', EVACUATE: 'default' };
    this.canvas.style.cursor = cursors[mode] ?? 'default';

    // Clear any road hover state when leaving COMMAND mode.
    if (mode !== 'COMMAND' && this.roads) this.roads.setHover(null);

    // Propagate evacuate-mode visual flag to all renderers.
    if (this.fireOverlay)  this.fireOverlay.setEvacMode(isEvac);
    if (this.roads)        this.roads.setEvacMode(isEvac);
    if (this.zones)        this.zones.setEvacMode(isEvac);
    if (this.routes)       this.routes.setEvacMode(isEvac);
    if (this.bottlenecks)  this.bottlenecks.setEvacMode(isEvac);
    if (this.shelters)     this.shelters.setEvacMode(isEvac);
    if (this.populations)  this.populations.setEvacMode(isEvac);
    if (this.contraflow)   this.contraflow.setEvacMode(isEvac);

    // Banner is visible only in EVACUATE mode.
    this.hud.setEvacBannerVisible(isEvac);
    if (isEvac && this.snapshot) {
      this.hud.updateEvacBanner({ ...this.snapshot, populations: this.scenario?.populations });
    }

    // EVACUATE: open the evac panel if it isn't already open.
    if (isEvac) {
      const panState = this.snapshot?.panels;
      if (panState && !panState.evacuation) {
        this.socket.emit('action', { type: 'panel', payload: 'evacuation' });
      }
    }
  }

  _onCanvasHover(ev) {
    if (this._currentMode !== 'COMMAND' || !this.roads || this.ar.active) return;
    if (this.desktop.dragging) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    const hit = this.roads.pickEdge(this.scene.camera, x, y);
    this.roads.setHover(hit);
    this.canvas.style.cursor = hit !== null ? 'pointer' : 'crosshair';
  }

  _buildWorld() {
    if (!this.scenario) return;
    const sg = this.scene.terrainGroup;
    while (sg.children.length) sg.remove(sg.children[0]);

    this.terrain = new TerrainMesh(this.scenario);
    sg.add(this.terrain.mesh);

    this.roads = new RoadRenderer(this.scenario, this.terrain);
    sg.add(this.roads.group);

    this.shelters = new ShelterMarker(this.scenario, this.terrain);
    sg.add(this.shelters.group);

    this.populations = new PopulationDots(this.scenario, this.terrain);
    sg.add(this.populations.group);

    this.zones = new ZoneRenderer(this.scenario, this.terrain);
    sg.add(this.zones.group);

    this.routes = new RouteAnimator(this.scenario, this.terrain);
    sg.add(this.routes.group);

    this.bottlenecks = new BottleneckMarker(this.scenario, this.terrain);
    sg.add(this.bottlenecks.group);

    this.contraflow = new ContraflowAnimator(this.scenario, this.terrain);
    sg.add(this.contraflow.group);

    this.proactive = new ProactiveOverlay(this.scenario, this.terrain);
    sg.add(this.proactive.group);

    this.compass = new CompassMarkers();
    sg.add(this.compass.group);

    this.perimeter = new PerimeterOverlay(this.scenario, this.terrain);
    sg.add(this.perimeter.group);

    this.windInd = new WindIndicator();
    sg.add(this.windInd.group);
    if (this.snapshot?.weather) {
      this.windInd.setWind(this.snapshot.weather.windDeg, this.snapshot.weather.windKph, this.snapshot.weather.redFlag);
    }

    this.fireCA = new CellularAutomata(this.scenario);
    this.fireOverlay = new FireOverlay(this.scenario, this.terrain, this.fireCA);
    sg.add(this.fireOverlay.mesh);

    this._wireFireCAUpdates();

    if (this.snapshot) this._applyEvacuationToScene(this.snapshot);
  }

  _wireFireCAUpdates() {
    if (!this.fireCA) return;
    this.fireCA.onUpdate = (stats) => {
      this.socket.emit('fire:state', {
        burningCells: stats.burning,
        perimeterCells: stats.perimeter,
        burnedCells: stats.burned,
        arrivalByNode: this.fireCA.arrivalByNode(this.scenario.nodes)
      });
    };
  }

  _maybeSnapCA(simMin, force = false) {
    if (!this.fireCA) return;
    if (!force && simMin - this._lastCaSnapMin < this.CA_SNAP_INTERVAL_MIN) return;
    this._lastCaSnapMin = simMin;
    this.caRing.push({ simMin, snap: this.fireCA.snapshot() });
    while (this.caRing.length > this.CA_RING_MAX) this.caRing.shift();
  }

  _findCaSnap(targetMin) {
    let best = null;
    for (const e of this.caRing) {
      if (e.simMin <= targetMin && (!best || e.simMin > best.simMin)) best = e;
    }
    return best;
  }

  _applyEvacuationToScene(snap) {
    if (this.zones) this.zones.applySnapshot(snap);
    if (this.routes) this.routes.applySnapshot(snap);
    if (this.bottlenecks) this.bottlenecks.applySnapshot(snap);
    if (this.populations) this.populations.applySnapshot(snap);

    // Route invariant: every zone with a computed route shows its escape
    // path. L3/GO zones still draw the most prominent particles via
    // RouteAnimator; the road overlay color is the same green so blockers
    // recompute every zone's route uniformly.
    if (this.roads && snap?.evacuation?.zones) {
      const primaryEdges = [], secondaryEdges = [];
      for (const z of snap.evacuation.zones) {
        if (!z.route) continue;
        if (z.route.edgeIds)          primaryEdges.push(...z.route.edgeIds);
        if (z.route.secondaryEdgeIds) secondaryEdges.push(...z.route.secondaryEdgeIds);
      }
      this.roads.setRoutePrimary(primaryEdges, secondaryEdges);
    }

    // Re-apply blocked / contraflow flags from snapshot
    if (this.roads && snap) {
      if (Array.isArray(snap.edgeBlockedIds)) {
        for (const eid of snap.edgeBlockedIds) {
          this.roads.applyEdgeUpdate({ id: eid, blocked: true, contra: false });
        }
      }
      if (Array.isArray(snap.edgeContraflowIds)) {
        for (const eid of snap.edgeContraflowIds) {
          this.roads.applyEdgeUpdate({ id: eid, blocked: false, contra: true });
        }
      }
    }

    if (this.shelters && snap?.evacuation?.shelterUsage) {
      this.shelters.setUsage(snap.evacuation.shelterUsage);
    }

    if (this.contraflow) this.contraflow.applySnapshot(snap);
  }

  _handleCanvasClick(ev) {
    if (this.desktop.hasDragged) return;
    if (!this.snapshot) return;
    const mode = this.snapshot.mode;
    if (mode !== 'COMMAND' && mode !== 'EVACUATE') return;
    const rect = this.canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

    if (mode === 'COMMAND' && this.roads) {
      const hit = this.roads.pickEdge(this.scene.camera, x, y);
      if (hit !== null) {
        const edge = this.scenario.edges.find(ed => ed.id === hit);
        this.socket.emit('action', {
          type: 'block-road',
          payload: { edgeId: hit, blocked: !edge?.blocked }
        });
      }
    } else if (mode === 'EVACUATE' && this.zones) {
      const zoneName = this.zones.pickZone(this.scene.camera, x, y);
      if (zoneName) {
        const zone = this.snapshot.evacuation?.zones?.find(z => z.name === zoneName);
        if (zone) {
          // Cycle: 1 (READY) → 2 (SET) → 3 (GO) → 1
          const nextLevel = (zone.level % 3) + 1;
          this.socket.emit('action', {
            type: 'override-zone',
            payload: { zoneId: zone.id, level: nextLevel }
          });
        }
      }
    }
  }

  _raf() {
    const renderer = this.scene.renderer;
    renderer.setAnimationLoop((t) => this._frame(t));
  }

  _frame(t) {
    const dt = this.scene.clock.getDelta();
    this.desktop.update(dt);

    if (this.fireCA && !this.ar.active) {
      this.fireCA.step(dt, this.scene.camera);
      this.fireOverlay.update(dt);
    } else if (this.fireCA && this.ar.active) {
      this.fireCA.step(dt);
      this.fireOverlay.update(dt);
    }
    if (this.roads) this.roads.update(dt);
    if (this.routes) this.routes.update(dt);
    if (this.populations) this.populations.update(dt);
    if (this.bottlenecks) this.bottlenecks.update(dt, this.scene.camera);
    if (this.zones) this.zones.update(dt);
    if (this.contraflow) this.contraflow.update(dt);
    if (this.proactive) this.proactive.update(dt, this.scene.camera);
    if (this.windInd) this.windInd.update(dt);
    if (this.panels?.panels?.weather) this.panels.panels.weather.setAzimuth(this.desktop.azimuth);
    this.scene.update(dt);
    this.scene.renderer.render(this.scene.scene, this.scene.camera);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
