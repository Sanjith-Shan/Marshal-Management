import { Panel } from './Panel.js';

export class WeatherPanel extends Panel {
  constructor(layer, position) {
    super(layer, 'WEATHER · NWS', position);
    this._windDeg = 220;
    this._azimuth = 0;   // camera horizontal angle in radians (from DesktopControls)

    this.body.innerHTML = `
      <div class="metric-grid">
        <div class="metric"><span class="metric-label">Wind</span><span class="metric-val" id="w-wind">—</span></div>
        <div class="metric"><span class="metric-label">Gusts</span><span class="metric-val" id="w-gust">—</span></div>
        <div class="metric"><span class="metric-label">Direction</span><span class="metric-val" id="w-dir">—</span></div>
        <div class="metric"><span class="metric-label">Humidity</span><span class="metric-val" id="w-rh">—</span></div>
        <div class="metric"><span class="metric-label">Temp</span><span class="metric-val" id="w-tmp">—</span></div>
        <div class="metric"><span class="metric-label">Source</span><span class="metric-val" style="font-size:13px" id="w-src">—</span></div>
      </div>

      <h3>WIND RELATIVE TO VIEW</h3>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
        <svg class="wind-arrow" viewBox="-50 -50 100 100" style="flex-shrink:0">
          <circle cx="0" cy="0" r="44" fill="none" stroke="rgba(108,207,255,0.15)" stroke-width="1"/>
          <!-- tick marks at every 45° -->
          <circle cx="0" cy="-44" r="1.5" fill="rgba(108,207,255,0.2)"/>
          <circle cx="31" cy="-31" r="1" fill="rgba(108,207,255,0.12)"/>
          <circle cx="44" cy="0" r="1.5" fill="rgba(108,207,255,0.2)"/>
          <circle cx="31" cy="31" r="1" fill="rgba(108,207,255,0.12)"/>
          <circle cx="0" cy="44" r="1.5" fill="rgba(108,207,255,0.2)"/>
          <circle cx="-31" cy="31" r="1" fill="rgba(108,207,255,0.12)"/>
          <circle cx="-44" cy="0" r="1.5" fill="rgba(108,207,255,0.2)"/>
          <circle cx="-31" cy="-31" r="1" fill="rgba(108,207,255,0.12)"/>
          <!-- Camera forward indicator: small cyan triangle at top, fixed -->
          <polygon points="0,-48 -3,-42 3,-42" fill="rgba(108,207,255,0.6)" title="your view direction"/>
          <!-- Compass ring: rotates by -azimuth so N label tracks actual north in scene -->
          <g id="w-compass-ring" transform="rotate(0)">
            <text x="0" y="-35" text-anchor="middle" font-size="9" font-weight="700" fill="rgba(108,207,255,0.85)">N</text>
            <text x="35" y="4"  text-anchor="middle" font-size="7" fill="rgba(255,255,255,0.35)">E</text>
            <text x="0" y="42"  text-anchor="middle" font-size="7" fill="rgba(255,255,255,0.35)">S</text>
            <text x="-35" y="4" text-anchor="middle" font-size="7" fill="rgba(255,255,255,0.35)">W</text>
          </g>
          <!-- Wind arrow: rotates in absolute terrain space (same frame as ring) -->
          <!-- Points TOWARD where fire moves; tail = wind origin -->
          <g id="w-arrow" transform="rotate(0)">
            <path d="M0,26 L0,-18 M-6,-11 L0,-22 L6,-11"
                  stroke="#ff5f5f" stroke-width="2.5" fill="none" stroke-linecap="round"/>
            <circle cx="0" cy="29" r="3" fill="#ff5f5f" opacity="0.7"/>
          </g>
        </svg>
        <div style="font-size:11px;line-height:1.7;color:var(--text-dim)">
          <div><span style="color:var(--text)">▲</span> = your view</div>
          <div><span style="color:rgba(108,207,255,0.85)">N</span> = scene north</div>
          <div><span style="color:#ff5f5f">● → arrow</span> = fire moves</div>
          <div id="w-rel-label" style="margin-top:4px;color:var(--accent-warm);font-weight:600">—</div>
        </div>
      </div>

      <h3>FIRE CONDITIONS</h3>
      <div id="w-fire-index" style="margin-bottom:6px"></div>
      <div id="w-fire-detail" style="font-size:11px;color:var(--text-dim);line-height:1.5"></div>
      <h3>RED FLAG</h3>
      <div id="w-rf" style="font-size:12px;letter-spacing:0.06em">—</div>
    `;
  }

  update(w) {
    if (!w) return;
    const $ = (id) => this.body.querySelector('#' + id);

    const windMph = kphToMph(w.windKph);
    const gustMph = kphToMph(w.gustKph);
    const rh = Math.round(w.humidity);
    this._windDeg = w.windDeg;

    $('w-wind').textContent = `${windMph} mph`;
    $('w-gust').textContent = `${gustMph} mph`;
    $('w-dir').textContent  = `${Math.round(w.windDeg)}° ${cardinal(w.windDeg)}`;
    $('w-rh').textContent   = `${rh}%`;
    $('w-tmp').textContent  = `${cToF(w.tempC)}°F`;
    $('w-src').textContent  = w.station || w.source || 'NWS';

    if (windMph > 31) $('w-wind').classList.add('warn');
    else              $('w-wind').classList.remove('warn');

    const titleEl = this.el.querySelector('.panel-title');
    if (titleEl) titleEl.textContent = `WEATHER · ${(w.station || 'NWS').toUpperCase()}`;

    this._updateCompass();

    // Fire behavior
    const { label, color, details } = fireConditions(windMph, gustMph, rh);
    $('w-fire-index').innerHTML =
      `<span style="font-weight:700;letter-spacing:0.1em;color:${color}">${label}</span>` +
      `<span style="font-size:10px;color:var(--text-dim);margin-left:6px">spread potential</span>`;
    $('w-fire-detail').innerHTML = details.join('<br>');

    // Red flag
    const rf = $('w-rf');
    if (w.redFlag) {
      rf.innerHTML = '<span style="color:#ff5f5f;font-weight:700">⚑ RED FLAG WARNING</span>' +
        `<div style="color:#8b96a6;margin-top:4px">High wind + low humidity. Aggressive spotting and spread expected.</div>`;
    } else {
      const rhToFlag  = 25 - rh;
      const mphToFlag = 16 - windMph;
      let note = 'No active red-flag advisory.';
      if (rhToFlag > 0 && mphToFlag > 0)
        note += ` −${rhToFlag}% RH or +${mphToFlag} mph would trigger.`;
      rf.innerHTML = `<span style="color:#8b96a6">${note}</span>`;
    }
  }

  // Called every frame from App._frame() with the current camera horizontal angle.
  setAzimuth(rad) {
    this._azimuth = rad;
    this._updateCompass();
  }

  _updateCompass() {
    const ring  = this.body.querySelector('#w-compass-ring');
    const arrow = this.body.querySelector('#w-arrow');
    const label = this.body.querySelector('#w-rel-label');
    if (!ring || !arrow) return;

    const azDeg = this._azimuth * (180 / Math.PI);
    // Ring rotates opposite to camera so N tracks actual scene north.
    ring.setAttribute('transform', `rotate(${-azDeg})`);
    // Arrow points in absolute wind-TOWARD direction (fire spread direction).
    arrow.setAttribute('transform', `rotate(${this._windDeg + 180})`);

    // Relative label: what direction relative to current view does wind come from?
    if (label) {
      const fromCard = cardinal(this._windDeg);
      const toCard   = cardinal((this._windDeg + 180) % 360);
      label.textContent = `FROM ${fromCard} → fire ${toCard}`;
    }
  }
}

function kphToMph(kph) { return Math.round(kph * 0.621371); }
function cToF(c)        { return Math.round(c * 9 / 5 + 32); }

function cardinal(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function fireConditions(windMph, gustMph, rh) {
  const details = [];
  let label, color;

  if (windMph < 10 && rh > 40) {
    label = 'LOW';     color = 'var(--accent-good)';
    details.push('Winds below threshold. Fire spread slow and predictable.');
  } else if (windMph < 16 || rh > 30) {
    label = 'MODERATE'; color = 'var(--accent)';
    details.push('Moderate spread expected. Monitor perimeter closely.');
  } else if (windMph < 25 || rh > 20) {
    label = 'HIGH';    color = 'var(--accent-warm)';
    details.push('Rapid spread likely. Pre-position resources, expand evacuation zones.');
  } else {
    label = 'EXTREME'; color = 'var(--accent-hot)';
    details.push('Extreme spread. Erratic fire behavior. Protect all zones immediately.');
  }

  if (gustMph > 35)
    details.push(`Gusts ${gustMph} mph — long-range spotting likely, fire may jump roads.`);
  else if (gustMph > 22)
    details.push(`Gusts ${gustMph} mph — short-range spotting possible.`);

  if (rh < 15)
    details.push(`RH ${rh}% — fuels critically dry, ignition risk very high.`);
  else if (rh < 25)
    details.push(`RH ${rh}% — fine fuels dry, easy re-ignition along perimeter.`);

  return { label, color, details };
}
