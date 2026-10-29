// ARPanels — 3D-native floating info panels for AR. DOM panels render to a
// canvas overlay that the Quest passthrough compositor doesn't show, so we
// build textured planes positioned around the user's head.
//
// Layout: four panels arranged in a horizontal arc at chest height around
// the user (origin = where they entered AR). Order left → right:
//   weather  (–55°)
//   evacuation (–22°)
//   advisor  (+22°)
//   video    (+55°)
//
// Each panel owns:
//   - A 1024×768 canvas drawn with the same data the DOM panel receives.
//   - A CanvasTexture mapped onto a PlaneGeometry (~0.5×0.375 m).
//   - A visibility flag controlled by the server's `panels` state.
//
// Visibility wiring is unchanged: the server's `panels` event still flips
// the same shared bools; ARPanels.setVisibility just routes them onto the
// 3D plane meshes instead of (or in parallel with) the DOM panels.

import * as THREE from 'three';

const RADIUS = 1.15;            // distance from user (m)
const PANEL_W = 0.50;
const PANEL_H = 0.375;
const PANEL_HEIGHT = 1.45;      // y-position above floor (≈ standing chest)
const ANGLES_DEG = {
  weather: -55,
  evacuation: -22,
  advisor: 22,
  video: 55,
};

const STYLE = {
  bg: 'rgba(14, 19, 26, 0.9)',
  border: 'rgba(255, 255, 255, 0.16)',
  title: '#e9eef4',
  text: '#e9eef4',
  dim: '#8d97a5',
  warn: '#f4a43a',
  hot: '#ff5b4f',
  good: '#3fcf8e',
};

export class ARPanels {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'ar-panels';
    this.group.visible = false;       // hidden until AR session active
    this.scene.add(this.group);

    this.active = false;
    this.visMap = { weather: false, evacuation: false, advisor: true, video: false };

    this.panels = {};
    for (const [name, deg] of Object.entries(ANGLES_DEG)) {
      this.panels[name] = this._makePanel(name, deg);
    }

    // Scratch state mirrored from server snapshots / events
    this._weather = null;
    this._evac = null;
    this._advisor = [];          // last N messages
    this._scenarioName = null;
    this._simTimeMin = 0;

    this._redraw();
  }

  _makePanel(name, angleDeg) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 768;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.anisotropy = 4;

    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), mat);

    const rad = angleDeg * Math.PI / 180;
    const x = Math.sin(rad) * RADIUS;
    const z = -Math.cos(rad) * RADIUS;
    mesh.position.set(x, PANEL_HEIGHT, z);
    mesh.lookAt(0, PANEL_HEIGHT, 0);
    mesh.renderOrder = 100;
    mesh.visible = false;
    this.group.add(mesh);

    return { name, canvas, ctx: canvas.getContext('2d'), tex, mesh };
  }

  // Toggle the entire AR panel group on/off (called by ARSession on
  // enter/exit). Individual visibility still respects this.visMap so that
  // exiting AR doesn't lose the user's panel preferences.
  setActive(active) {
    this.active = active;
    this.group.visible = active;
    if (active) this._applyVisibility();
  }

  setVisibility(visMap) {
    if (!visMap) return;
    this.visMap = { ...this.visMap, ...visMap };
    this._applyVisibility();
  }

  _applyVisibility() {
    for (const [name, p] of Object.entries(this.panels)) {
      p.mesh.visible = this.active && !!this.visMap[name];
    }
  }

  // ---- data hooks (mirror the DOM panel API used by main.js) ----

  setScenarioContext(scenario) {
    this._scenarioName = scenario?.scenarioName || scenario?.name || null;
  }

  applySnapshot(snap) {
    if (!snap) return;
    if (snap.panels) this.setVisibility(snap.panels);
    if (snap.weather) { this._weather = snap.weather; this._draw('weather'); }
    if (snap.evacuation) { this._evac = snap.evacuation; this._draw('evacuation'); }
    if (Array.isArray(snap.advisorMessages)) {
      this._advisor = snap.advisorMessages.slice(-8);
      this._draw('advisor');
    }
    if (snap.simTimeMin != null) this._simTimeMin = snap.simTimeMin;
    this._draw('video'); // video is mostly static
  }

  setSimTime(min) {
    this._simTimeMin = min;
    this._draw('evacuation');
  }

  updateWeather(w) { this._weather = w; this._draw('weather'); }
  updateEvacuation(ev) { this._evac = ev; this._draw('evacuation'); }
  appendAdvisor(msg) {
    this._advisor.push(msg);
    if (this._advisor.length > 8) this._advisor = this._advisor.slice(-8);
    this._draw('advisor');
  }
  setAdvisorHistory(msgs) {
    this._advisor = (msgs || []).slice(-8);
    this._draw('advisor');
  }

  // ---- drawing ----

  _redraw() {
    for (const name of Object.keys(this.panels)) this._draw(name);
  }

  _draw(name) {
    const p = this.panels[name];
    if (!p) return;
    const { ctx, canvas } = p;
    this._drawChrome(ctx, canvas, this._titleFor(name));
    if (name === 'weather') this._drawWeather(ctx, canvas);
    else if (name === 'evacuation') this._drawEvacuation(ctx, canvas);
    else if (name === 'advisor') this._drawAdvisor(ctx, canvas);
    else if (name === 'video') this._drawVideo(ctx, canvas);
    p.tex.needsUpdate = true;
  }

  _titleFor(name) {
    return ({
      weather: 'WEATHER · NWS',
      evacuation: 'EVACUATION',
      advisor: 'AI ADVISOR',
      video: 'FIELD VIDEO',
    })[name] || name.toUpperCase();
  }

  _drawChrome(ctx, canvas, title) {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    // Glass body
    roundRect(ctx, 8, 8, w - 16, h - 16, 28);
    ctx.fillStyle = STYLE.bg;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = STYLE.border;
    ctx.stroke();
    // Title bar
    ctx.fillStyle = STYLE.title;
    ctx.font = '600 36px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(title, 36, 32);
    // Underline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(36, 88);
    ctx.lineTo(w - 36, 88);
    ctx.stroke();
  }

  _drawWeather(ctx, canvas) {
    const w = this._weather;
    let y = 120;
    const left = 50;
    if (!w) {
      ctx.fillStyle = STYLE.dim;
      ctx.font = '24px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillText('Awaiting NWS feed…', left, y);
      return;
    }
    const windMph = Math.round(w.windKph * 0.621371);
    const gustMph = Math.round((w.gustKph || 0) * 0.621371);
    const tempF = Math.round(w.tempC * 9 / 5 + 32);
    const rh = Math.round(w.humidity);

    const rows = [
      ['Wind',     `${windMph} mph @ ${Math.round(w.windDeg)}° ${cardinal(w.windDeg)}`, windMph > 31 ? STYLE.warn : STYLE.text],
      ['Gusts',    `${gustMph} mph`, gustMph > 35 ? STYLE.warn : STYLE.text],
      ['Humidity', `${rh}%`,         rh < 25 ? STYLE.warn : STYLE.text],
      ['Temp',     `${tempF}°F`,     STYLE.text],
      ['Source',   `${w.station || w.source || 'NWS'}`, STYLE.dim],
    ];
    ctx.font = '600 26px "JetBrains Mono", ui-monospace, monospace';
    for (const [k, v, color] of rows) {
      ctx.fillStyle = STYLE.dim;
      ctx.fillText(k.padEnd(10), left, y);
      ctx.fillStyle = color;
      ctx.fillText(v, left + 200, y);
      y += 50;
    }
    y += 20;
    if (w.redFlag) {
      ctx.fillStyle = STYLE.hot;
      ctx.font = '700 34px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillText('⚑ RED FLAG WARNING', left, y);
      ctx.font = '500 22px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillStyle = STYLE.dim;
      ctx.fillText('Aggressive spotting + spread expected.', left, y + 44);
    } else {
      ctx.fillStyle = STYLE.good;
      ctx.font = '600 24px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillText('No red-flag advisory active.', left, y);
    }
  }

  _drawEvacuation(ctx, canvas) {
    const ev = this._evac;
    let y = 120;
    const left = 50;
    if (!ev) {
      ctx.fillStyle = STYLE.dim;
      ctx.font = '24px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillText('No evacuation engine output yet.', left, y);
      ctx.fillText('Press EVACUATE on the board (E) to compute routes.', left, y + 36);
      return;
    }
    // Overview row
    ctx.font = '600 22px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = STYLE.dim;
    ctx.fillText(`T+${formatMin(this._simTimeMin)} · last run T+${formatMin(ev.lastRunSimMin || 0)}`, left, y);
    y += 36;

    // Zones
    ctx.font = '700 24px "JetBrains Mono", ui-monospace, monospace';
    const zones = (ev.zones || []).slice(0, 6);
    for (const z of zones) {
      const lvlColor = z.level >= 3 ? STYLE.hot : z.level === 2 ? STYLE.warn : STYLE.title;
      const tag = z.level === 3 ? 'GO' : z.level === 2 ? 'SET' : 'READY';
      ctx.fillStyle = lvlColor;
      ctx.fillText(`[${tag}]`, left, y);
      ctx.fillStyle = STYLE.text;
      const name = (z.name || z.id || '').padEnd(20).slice(0, 20);
      ctx.fillText(name, left + 130, y);
      ctx.fillStyle = STYLE.dim;
      ctx.font = '500 20px "JetBrains Mono", ui-monospace, monospace';
      const pop = z.population || 0;
      const eta = z.evacMin ? `${Math.round(z.evacMin)}m` : '—';
      const margin = z.safetyMargin != null ? `${Math.round(z.safetyMargin)}m mar` : '';
      ctx.fillText(`pop ${pop}  evac ${eta}  ${margin}`, left + 130, y + 28);
      y += 60;
      ctx.font = '700 24px "JetBrains Mono", ui-monospace, monospace';
      if (y > canvas.height - 80) break;
    }
    if (zones.length === 0) {
      ctx.fillStyle = STYLE.dim;
      ctx.font = '24px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillText('No zones declared yet.', left, y);
    }
  }

  _drawAdvisor(ctx, canvas) {
    let y = 120;
    const left = 50;
    const right = canvas.width - 50;
    if (this._advisor.length === 0) {
      ctx.fillStyle = STYLE.dim;
      ctx.font = '24px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillText('AI advisor idle. Hold push-to-talk to query.', left, y);
      return;
    }
    ctx.font = '500 22px "JetBrains Mono", ui-monospace, monospace';
    const recent = this._advisor.slice(-6);
    for (const m of recent) {
      const sev = m?.severity || 'info';
      const color = sev === 'crit' ? STYLE.hot : sev === 'warn' ? STYLE.warn : STYLE.text;
      ctx.fillStyle = color;
      const text = (m?.text || m?.message || String(m || '')).slice(0, 200);
      const wrapped = wrapText(ctx, text, right - left);
      for (const line of wrapped.slice(0, 3)) {
        ctx.fillText(line, left, y);
        y += 30;
        if (y > canvas.height - 60) return;
      }
      y += 12;
    }
  }

  _drawVideo(ctx, canvas) {
    const left = 50, top = 120;
    const w = canvas.width - 100, h = canvas.height - 170;
    // Four "feed" tiles in a 2×2 grid
    const cols = 2, rows = 2;
    const tw = w / cols - 16, th = h / rows - 16;
    ctx.font = '600 20px "JetBrains Mono", ui-monospace, monospace';
    const labels = ['CAM-1 · Cedar Creek', 'CAM-2 · Scripps Ranch', 'CAM-3 · I-15 ramp', 'CAM-4 · Poway HS'];
    for (let i = 0; i < 4; i++) {
      const cx = left + (i % 2) * (tw + 16);
      const cy = top + Math.floor(i / 2) * (th + 16);
      ctx.fillStyle = 'rgba(14, 19, 26, 0.85)';
      ctx.fillRect(cx, cy, tw, th);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx, cy, tw, th);
      // Static-y noise dots
      for (let n = 0; n < 60; n++) {
        const px = cx + Math.random() * tw;
        const py = cy + Math.random() * th;
        ctx.fillStyle = `rgba(180, 200, 220, ${0.05 + Math.random() * 0.12})`;
        ctx.fillRect(px, py, 2, 2);
      }
      ctx.fillStyle = STYLE.dim;
      ctx.fillText(labels[i], cx + 12, cy + th - 24);
      ctx.fillStyle = STYLE.hot;
      ctx.beginPath();
      ctx.arc(cx + tw - 18, cy + 18, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function cardinal(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function formatMin(min) {
  const m = Math.max(0, Math.round(min || 0));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return hh > 0 ? `${hh}:${String(mm).padStart(2, '0')}` : `${mm}m`;
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}
