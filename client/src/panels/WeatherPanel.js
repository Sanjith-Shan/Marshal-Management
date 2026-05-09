import { Panel } from './Panel.js';

export class WeatherPanel extends Panel {
  constructor(layer, position) {
    super(layer, 'WEATHER · NWS', position);
    this.body.innerHTML = `
      <div class="metric-grid">
        <div class="metric"><span class="metric-label">Wind</span><span class="metric-val" id="w-wind">—</span></div>
        <div class="metric"><span class="metric-label">Gusts</span><span class="metric-val" id="w-gust">—</span></div>
        <div class="metric"><span class="metric-label">Direction</span><span class="metric-val" id="w-dir">—</span></div>
        <div class="metric"><span class="metric-label">Humidity</span><span class="metric-val" id="w-rh">—</span></div>
        <div class="metric"><span class="metric-label">Temp</span><span class="metric-val" id="w-tmp">—</span></div>
        <div class="metric"><span class="metric-label">Source</span><span class="metric-val" style="font-size:13px" id="w-src">—</span></div>
      </div>
      <h3>WIND VECTOR</h3>
      <svg class="wind-arrow" viewBox="-50 -50 100 100">
        <circle cx="0" cy="0" r="44" fill="none" stroke="rgba(108,207,255,0.18)" stroke-width="1"/>
        <line x1="-44" y1="0" x2="44" y2="0" stroke="rgba(108,207,255,0.1)" stroke-width="0.5"/>
        <line x1="0" y1="-44" x2="0" y2="44" stroke="rgba(108,207,255,0.1)" stroke-width="0.5"/>
        <text x="0" y="-46" text-anchor="middle" font-size="8" fill="rgba(255,255,255,0.5)">N</text>
        <g id="w-arrow" transform="rotate(0)">
          <path d="M0,30 L0,-22 M-7,-15 L0,-26 L7,-15"
                stroke="#ff5f5f" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        </g>
      </svg>
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

    const windKph = Math.round(w.windKph);
    const gustKph = Math.round(w.gustKph);
    const rh = Math.round(w.humidity);

    $('w-wind').textContent = `${windKph} kph`;
    $('w-gust').textContent = `${gustKph} kph`;
    $('w-dir').textContent = `${Math.round(w.windDeg)}° ${cardinal(w.windDeg)}`;
    $('w-rh').textContent  = `${rh}%`;
    $('w-tmp').textContent = `${Math.round(w.tempC)}°C`;
    $('w-src').textContent = w.station || w.source || 'NWS';

    if (windKph > 50) $('w-wind').classList.add('warn');
    else              $('w-wind').classList.remove('warn');

    // Update panel title to reflect live station
    const titleEl = this.el.querySelector('.panel-title');
    if (titleEl) titleEl.textContent = `WEATHER · ${(w.station || 'NWS').toUpperCase()}`;

    const arrow = this.body.querySelector('#w-arrow');
    if (arrow) arrow.setAttribute('transform', `rotate(${w.windDeg + 180})`);

    // Fire behavior interpretation
    const { label, color, details } = fireConditions(windKph, gustKph, rh);
    $('w-fire-index').innerHTML =
      `<span style="font-weight:700;letter-spacing:0.1em;color:${color}">${label}</span>
       <span style="font-size:10px;color:var(--text-dim);margin-left:6px">spread potential</span>`;
    $('w-fire-detail').innerHTML = details.join('<br>');

    // Red flag
    const rf = $('w-rf');
    if (w.redFlag) {
      rf.innerHTML = '<span style="color:#ff5f5f;font-weight:700">⚑ RED FLAG WARNING</span>'
        + `<div style="color:#8b96a6;margin-top:4px">High wind + low humidity. Aggressive spotting and spread expected.</div>`;
    } else {
      const rhToFlag = 25 - rh;
      const kphToFlag = 25 - windKph;
      let note = 'No active red-flag advisory.';
      if (rhToFlag > 0 && kphToFlag > 0) {
        note += ` +${kphToFlag} kph wind or −${rhToFlag}% RH would trigger.`;
      }
      rf.innerHTML = `<span style="color:#8b96a6">${note}</span>`;
    }
  }
}

// Cardinal compass label from a FROM-direction in degrees.
function cardinal(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// Qualitative fire behavior index based on wind + RH.
// Thresholds loosely match NWS Fire Weather criteria.
function fireConditions(windKph, gustKph, rh) {
  const details = [];

  // Spread rate based on sustained wind
  let spreadLabel, spreadColor;
  if (windKph < 15 && rh > 40) {
    spreadLabel = 'LOW'; spreadColor = 'var(--accent-good)';
    details.push('Sustained winds below threshold. Fire spread slow and predictable.');
  } else if (windKph < 25 || rh > 30) {
    spreadLabel = 'MODERATE'; spreadColor = 'var(--accent)';
    details.push('Moderate spread expected. Monitor perimeter closely.');
  } else if (windKph < 40 || rh > 20) {
    spreadLabel = 'HIGH'; spreadColor = 'var(--accent-warm)';
    details.push('Rapid spread likely. Pre-position resources, expand evacuation zones.');
  } else {
    spreadLabel = 'EXTREME'; spreadColor = 'var(--accent-hot)';
    details.push('Extreme spread. Erratic fire behavior. Protect all zones immediately.');
  }

  // Spotting risk from gusts
  if (gustKph > 55) {
    details.push(`Gusts ${gustKph} kph — long-range spotting likely, fire may jump roads.`);
  } else if (gustKph > 35) {
    details.push(`Gusts ${gustKph} kph — short-range spotting possible.`);
  }

  // RH context
  if (rh < 15) {
    details.push(`RH ${rh}% — fuels critically dry, ignition risk very high.`);
  } else if (rh < 25) {
    details.push(`RH ${rh}% — fine fuels dry, easy re-ignition along perimeter.`);
  }

  return { label: spreadLabel, color: spreadColor, details };
}
