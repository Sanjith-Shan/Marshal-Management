// CellularAutomata — Rothermel-lite fire spread on a 128×128 grid.
// State per cell: 0=unburned 1=burning 2=burned. Spread probability per step
// is computed from fuel class, slope (from heightmap gradient), and wind
// direction/speed (from weather). Ember spotting jumps occasionally to a
// downwind cell. The CA also records "arrival minute" per cell, which is
// what the evacuation engine reads to decide when a road becomes blocked.
//
// Time model: one CA step = 0.5 simulated minutes; we step every 1 wall-second
// so the CA advances at 0.5 sim-min/wall-sec — exactly matching the server
// clock (StateManager.tickSimulation: +1 sim-min every 2 sec). Fire arrival
// stamps stay aligned with the displayed military-time HUD clock. The
// 'tick' socket handler in main.js also hard-syncs simMinutes to the
// server's authoritative simTimeMin every tick to correct any drift.

const STATE_UNBURNED = 0;
const STATE_BURNING = 1;
const STATE_BURNED = 2;

// Fuel-class spread base rates (chains/hr → normalized for the demo)
const FUEL_SPREAD = [
  0.0,   // rock — no fuel
  0.65,  // grass
  0.55,  // chaparral
  0.45,  // timber
  0.30,  // urban
];
const FUEL_BURN_DURATION = [
  0,    // rock
  3,    // grass: 3 steps to burn out
  8,    // chaparral
  12,   // timber
  6,    // urban
];

const STEP_INTERVAL = 1.0;        // seconds of wall time per CA step

export class CellularAutomata {
  constructor(scenario) {
    this.scenario = scenario;
    this.grid = scenario.gridSize;
    this.fuel = scenario.fuelGrid;
    this.height = scenario.heightmap;
    this.state = new Uint8Array(this.grid * this.grid);
    this.arrival = new Float32Array(this.grid * this.grid);  // minutes from t0
    this.burnTime = new Uint16Array(this.grid * this.grid);  // steps since ignition
    this.windDeg = 220;
    this.windKph = 35;
    this.tickAccum = 0;
    this.simMinutes = 0;
    this.stepCount = 0;
    this.onUpdate = null;
    this._cellArrivalSent = 0;
    this._paused = false;

    // Ignition
    const { gx, gy } = scenario.ignition;
    const idx = gy * this.grid + gx;
    this.state[idx] = STATE_BURNING;
    this.arrival[idx] = 0;
    // Pre-fill arrival as +Infinity (encoded as a large number)
    for (let i = 0; i < this.arrival.length; i++) {
      if (this.state[i] !== STATE_BURNING) this.arrival[i] = Infinity;
    }
    // Seed a small starter perimeter (3x3 around ignition)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= this.grid || ny >= this.grid) continue;
        const ni = ny * this.grid + nx;
        if (this.fuel[ni] !== 0) {
          this.state[ni] = STATE_BURNING;
          this.arrival[ni] = 0;
        }
      }
    }
  }

  setWind(deg, kph) {
    this.windDeg = deg;
    this.windKph = kph;
  }

  setPaused(paused) {
    this._paused = !!paused;
    if (!this._paused) this.tickAccum = 0;
  }

  step(dtSec) {
    if (this._paused) return false;
    this.tickAccum += dtSec;
    if (this.tickAccum < STEP_INTERVAL) return false;
    this.tickAccum -= STEP_INTERVAL;
    this._stepOnce();
    this.stepCount++;
    this.simMinutes += 0.5;
    if (this.onUpdate && this.stepCount % 4 === 0) {
      const stats = this.stats();
      this.onUpdate(stats);
    }
    return true;
  }

  _stepOnce() {
    const G = this.grid;
    const next = this.state.slice();
    const arr = this.arrival;
    const fuel = this.fuel;
    const h = this.height;

    // Wind unit vector (toward the wind blows, in cell coords)
    // Meteorological convention: windDeg = "FROM" direction.
    // Vector "TOWARD" = deg + 180.
    const toRad = (d) => (d + 180) * Math.PI / 180;
    const wRad = toRad(this.windDeg);
    const wx = Math.sin(wRad);
    const wy = -Math.cos(wRad);
    const windFactor = 1 + (this.windKph / 30);

    for (let y = 0; y < G; y++) {
      for (let x = 0; x < G; x++) {
        const i = y * G + x;
        if (this.state[i] !== STATE_BURNING) continue;
        // Burnout
        this.burnTime[i]++;
        const dur = FUEL_BURN_DURATION[fuel[i]] || 4;
        if (this.burnTime[i] >= dur) next[i] = STATE_BURNED;

        const baseRate = FUEL_SPREAD[fuel[i]] || 0;
        if (baseRate === 0) continue;

        // 8-neighbor spread
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
            const ni = ny * G + nx;
            if (this.state[ni] !== STATE_UNBURNED) continue;
            const nf = fuel[ni];
            if (nf === 0) continue;     // rock — no fuel
            const nRate = FUEL_SPREAD[nf];

            // Slope: uphill = faster (e^{0.06*slope%})
            const slope = (h[ni] - h[i]) * 50;       // ~ percent grade after scaling
            const slopeFactor = Math.exp(0.05 * slope);

            // Wind alignment: dot of (dx,dy) normalized with wind toward
            const dl = Math.hypot(dx, dy);
            const align = (dx * wx + dy * wy) / dl;
            const windAlign = align > 0
              ? (1 + align * (windFactor - 1))
              : Math.max(0.4, 1 + align * 0.5);

            const p = nRate * 0.4 * slopeFactor * windAlign;
            if (Math.random() < p) {
              next[ni] = STATE_BURNING;
              if (arr[ni] === Infinity) arr[ni] = this.simMinutes + 0.5;
            }
          }
        }
      }
    }

    // Ember spotting: with low probability, jump 4-8 cells downwind
    if (this.windKph > 25 && Math.random() < 0.3) {
      const burning = this._sampleBurning(8);
      for (const idx of burning) {
        const sx = idx % G, sy = Math.floor(idx / G);
        const dist = 4 + Math.floor(Math.random() * 5);
        const tx = Math.round(sx + wx * dist);
        const ty = Math.round(sy + wy * dist);
        if (tx < 0 || ty < 0 || tx >= G || ty >= G) continue;
        const ti = ty * G + tx;
        if (next[ti] === STATE_UNBURNED && fuel[ti] !== 0) {
          if (Math.random() < 0.5) {
            next[ti] = STATE_BURNING;
            if (arr[ti] === Infinity) arr[ti] = this.simMinutes + 0.5;
          }
        }
      }
    }

    this.state = next;
  }

  _sampleBurning(n) {
    const result = [];
    let tries = 0;
    while (result.length < n && tries < 60) {
      const i = Math.floor(Math.random() * this.state.length);
      if (this.state[i] === STATE_BURNING) result.push(i);
      tries++;
    }
    return result;
  }

  stats() {
    let burning = 0, burned = 0, perimeter = 0;
    const G = this.grid;
    for (let i = 0; i < this.state.length; i++) {
      if (this.state[i] === STATE_BURNING) {
        burning++;
        const x = i % G, y = (i - x) / G;
        // Counts as perimeter if any 4-neighbor is unburned
        const n4 = [
          y > 0 ? this.state[i - G] : 1,
          y < G - 1 ? this.state[i + G] : 1,
          x > 0 ? this.state[i - 1] : 1,
          x < G - 1 ? this.state[i + 1] : 1,
        ];
        if (n4.some(v => v === STATE_UNBURNED)) perimeter++;
      } else if (this.state[i] === STATE_BURNED) burned++;
    }
    return { burning, burned, perimeter };
  }

  // Capture full simulation state into a transferable snapshot. Used by the
  // time-jump system: forward jumps don't need this, but backward jumps
  // restore from the closest snapshot taken before the target sim-min.
  snapshot() {
    return {
      simMinutes: this.simMinutes,
      stepCount: this.stepCount,
      windDeg: this.windDeg,
      windKph: this.windKph,
      state: new Uint8Array(this.state),
      arrival: new Float32Array(this.arrival),
      burnTime: new Uint16Array(this.burnTime)
    };
  }

  restore(snap) {
    if (!snap) return;
    this.simMinutes = snap.simMinutes;
    this.stepCount = snap.stepCount;
    this.windDeg = snap.windDeg;
    this.windKph = snap.windKph;
    this.state = new Uint8Array(snap.state);
    this.arrival = new Float32Array(snap.arrival);
    this.burnTime = new Uint16Array(snap.burnTime);
    this.tickAccum = 0;
  }

  // Run N CA steps immediately, bypassing the wall-clock rate limit. Used by
  // the time-jump-forward action so the user can preview the fire 30 / 60
  // minutes ahead without waiting in real time.
  fastForward(steps) {
    const n = Math.max(0, Math.floor(steps));
    for (let i = 0; i < n; i++) {
      this._stepOnce();
      this.stepCount++;
      this.simMinutes += 0.5;
    }
    if (this.onUpdate && n > 0) this.onUpdate(this.stats());
    return n;
  }

  // For each road node, return arrival minutes (or large number if never).
  // The server uses this to remove edges from the graph as fire arrives.
  arrivalByNode(nodes) {
    const G = this.grid;
    const out = [];
    for (const n of nodes) {
      const gx = Math.max(0, Math.min(G - 1, Math.round(n.x)));
      const gy = Math.max(0, Math.min(G - 1, Math.round(n.z)));
      const a = this.arrival[gy * G + gx];
      out.push([n.id, Number.isFinite(a) ? a : 999]);
    }
    return out;
  }
}

export const FIRE_STATE = { STATE_UNBURNED, STATE_BURNING, STATE_BURNED };
