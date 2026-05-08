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
      console.log('[scenario] received', scn.name, scn.nodes.length + ' nodes', scn.edges.length + ' edges');
      this.scenario = scn;
      this.caRing = [];
      this._lastCaSnapMin = -Infinity;
      this._buildWorld();
    });

    this.socket.on('snapshot', (snap) => {
      this.snapshot = snap;
      this.hud.applySnapshot(snap);
      this.panels.applySnapshot(snap);
      this._applyEvacuationToScene(snap);
      if (this.fireCA && snap.weather) this.fireCA.setWind(snap.weather.windDeg, snap.weather.windKph);
    });

    this.socket.on('tick', ({ simTimeMin }) => {
      this.hud.setSimTime(simTimeMin);
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
    });

    this.socket.on('mode', (m) => this.hud.setMode(m));

    this.socket.on('panels', (panels) => this.panels.applyVisibility(panels));

    this.socket.on('evacuation', (ev) => {
      this.snapshot = { ...(this.snapshot || {}), evacuation: ev };
      this.panels.updateEvacuation(ev);
      this._applyEvacuationToScene(this.snapshot);
    });

    this.socket.on('advisor', (msg) => this.panels.appendAdvisor(msg));
    this.socket.on('fire', (f) => this.hud.setFire(f));

    this.socket.on('edge:update', (u) => {
      if (this.roads) this.roads.applyEdgeUpdate(u);
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

    // Click on a road in COMMAND mode → toggle blocked
    this.canvas.addEventListener('click', (e) => this._handleCanvasClick(e));
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

    // Highlight primary-route edges on the road network
    if (this.roads && snap?.evacuation?.zones) {
      const allRouteEdges = [];
      for (const z of snap.evacuation.zones) {
        if (z.route?.edgeIds && z.level >= 2) allRouteEdges.push(...z.route.edgeIds);
      }
      this.roads.setRoutePrimary(allRouteEdges);
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
  }

  _handleCanvasClick(e) {
    if (!this.snapshot || this.snapshot.mode !== 'COMMAND') return;
    if (!this.roads) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const hit = this.roads.pickEdge(this.scene.camera, x, y);
    if (hit !== null) {
      const e0 = this.scenario.edges.find(ed => ed.id === hit);
      this.socket.emit('action', {
        type: 'block-road',
        payload: { edgeId: hit, blocked: !e0?.blocked }
      });
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
    if (this.routes) this.routes.update(dt);
    if (this.populations) this.populations.update(dt);
    if (this.bottlenecks) this.bottlenecks.update(dt);
    if (this.zones) this.zones.update(dt);
    this.scene.update(dt);
    this.scene.renderer.render(this.scene.scene, this.scene.camera);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
