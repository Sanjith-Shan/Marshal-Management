import { Panel } from './Panel.js';

export class WeatherPanel extends Panel {
  constructor(layer, position) {
    super(layer, 'Weather', position);
    this._windDeg = 220;
    this._azimuth = 0;   // camera horizontal angle in radians (from DesktopControls)

    this.body.innerHTML = `
      <div class="metric-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="metric"><span class="metric-label">Wind</span><span class="metric-val" id="w-wind">—</span></div>
        <div class="metric"><span class="metric-label">Gusts</span><span class="metric-val" id="w-gust">—</span></div>
        <div class="metric"><span class="metric-label">Direction</span><span class="metric-val" id="w-dir">—</span></div>
        <div class="metric"><span class="metric-label">Humidity</span><span class="metric-val" id="w-rh">—</span></div>
        <div class="metric"><span class="metric-label">Temp</span><span class="metric-val" id="w-tmp">—</span></div>
        <div class="metric"><span class="metric-label">Station</span><span class="metric-val" id="w-src">—</span></div>
      </div>

      <h3>Wind relative to view</h3>
      <div class="wind-row">
        <svg class="wind-arrow" viewBox="-50 -50 100 100">
          <circle cx="0" cy="0" r="44" fill="rgba(255,255,255,0.025)" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
          <circle cx="0" cy="0" r="30" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
          <polygon points="0,-49 -3.5,-43 3.5,-43" fill="rgba(233,238,244,0.7)"/>
          <g id="w-compass-ring" transform="rotate(0)">
            <text x="0" y="-33" text-anchor="middle" font-size="9" font-weight="700" font-family="Inter, sans-serif" fill="#e9eef4">N</text>
            <text x="35" y="3.5" text-anchor="middle" font-size="7.5" font-family="Inter, sans-serif" fill="rgba(233,238,244,0.35)">E</text>
            <text x="0" y="40" text-anchor="middle" font-size="7.5" font-family="Inter, sans-serif" fill="rgba(233,238,244,0.35)">S</text>
            <text x="-35" y="3.5" text-anchor="middle" font-size="7.5" font-family="Inter, sans-serif" fill="rgba(233,238,244,0.35)">W</text>
          </g>
          <g id="w-arrow" transform="rotate(0)">
            <path d="M0,22 L0,-16 M-6,-9 L0,-19 L6,-9" stroke="#ff7a62" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="0" cy="25" r="2.6" fill="#ff7a62" opacity="0.6"/>
          </g>
        </svg>
        <div class="wind-caption">
          <div id="w-rel-label">—</div>
          <div style="color:var(--text-faint);font-size:11px;margin-top:2px">Arrow shows where the fire is pushed</div>
        </div>
      </div>

      <h3>Fire conditions</h3>
      <div id="w-fire-index"></div>
      <div id="w-fire-detail" class="cond-text"></div>
      <div id="w-rf" class="cond-text"></div>
    `;
  }

  update(w) {
    if (!w) return;
    const $ = (id) => this.body.querySelector('#' + id);

    const windMph = kphToMph(w.windKph);
    const gustMph = kphToMph(w.gustKph);
    const rh = Math.round(w.humidity);
    this._windDeg = w.windDeg;

    $('w-wind').innerHTML = `${windMph}<span class="unit">mph</span>`;
    $('w-gust').innerHTML = `${gustMph}<span class="unit">mph</span>`;
    $('w-dir').innerHTML  = `${Math.round(w.windDeg)}°<span class="unit">${cardinal(w.windDeg)}</span>`;
    $('w-rh').innerHTML   = `${rh}<span class="unit">%</span>`;
    $('w-tmp').innerHTML  = `${cToF(w.tempC)}<span class="unit">°F</span>`;
    $('w-src').textContent  = w.station || w.source || 'NWS';

    if (windMph > 31) $('w-wind').classList.add('warn');
    else              $('w-wind').classList.remove('warn');

    const titleEl = this.el.querySelector('.panel-title');
    if (titleEl) titleEl.textContent = `Weather · ${(w.station || 'NWS').toUpperCase()} live`;

    this._updateCompass();

    // Fire behavior
    const { label, color, details } = fireConditions(windMph, gustMph, rh);
    $('w-fire-index').innerHTML =
      `<span class="cond-badge" style="color:${color};background:color-mix(in srgb, ${color} 14%, transparent)">${label}</span>` +
      `<span style="font-size:12px;color:var(--text-dim)">spread potential</span>`;
    $('w-fire-detail').innerHTML = details.join(' ');

    // Red flag
    const rf = $('w-rf');
    if (w.redFlag) {
      rf.innerHTML = '<span style="color:#ff8a80;font-weight:600">Red flag warning.</span> High wind and low humidity, aggressive spotting expected.';
    } else {
      const rhToFlag  = 25 - rh;
      const mphToFlag = 16 - windMph;
      rf.textContent = 'No active red flag advisory.';
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
      label.innerHTML = `From <b>${fromCard}</b>, pushing fire <b>${toCard}</b>`;
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
    label = 'LOW';     color = '#3fcf8e';
    details.push('Winds below threshold. Fire spread slow and predictable.');
  } else if (windMph < 16 || rh > 30) {
    label = 'MODERATE'; color = '#5aa9ff';
    details.push('Moderate spread expected. Monitor perimeter closely.');
  } else if (windMph < 25 || rh > 20) {
    label = 'HIGH';    color = '#f4a43a';
    details.push('Rapid spread likely. Pre-position resources, expand evacuation zones.');
  } else {
    label = 'EXTREME'; color = '#ff5b4f';
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
