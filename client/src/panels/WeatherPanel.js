import { Panel } from './Panel.js';

export class WeatherPanel extends Panel {
  constructor(layer, position) {
    super(layer, 'WEATHER · NWS KSAN', position);
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
      <h3>RED FLAG</h3>
      <div id="w-rf" style="font-size:12px;letter-spacing:0.06em">—</div>
    `;
  }
  update(w) {
    if (!w) return;
    const $ = (id) => this.body.querySelector('#' + id);
    $('w-wind').textContent = `${Math.round(w.windKph)} kph`;
    $('w-gust').textContent = `${Math.round(w.gustKph)} kph`;
    $('w-dir').textContent = `${Math.round(w.windDeg)}°`;
    $('w-rh').textContent = `${Math.round(w.humidity)}%`;
    $('w-tmp').textContent = `${Math.round(w.tempC)}°C`;
    $('w-src').textContent = w.source || (w.station || 'NWS');
    if (w.windKph > 50) $('w-wind').classList.add('warn');
    const arrow = this.body.querySelector('#w-arrow');
    if (arrow) arrow.setAttribute('transform', `rotate(${w.windDeg + 180})`);
    const rf = $('w-rf');
    if (w.redFlag) {
      rf.innerHTML = '<span style="color:#ff5f5f;font-weight:700">⚑ RED FLAG WARNING</span><div style="color:#8b96a6;margin-top:4px">High wind + low humidity. Aggressive fire spread expected.</div>';
    } else {
      rf.innerHTML = '<span style="color:#8b96a6">No active red-flag advisory.</span>';
    }
  }
}
