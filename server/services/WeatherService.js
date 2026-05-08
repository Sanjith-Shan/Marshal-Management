// WeatherService — pulls live wind / temp from NWS api.weather.gov (no API
// key required). Falls back to a procedurally-shifting mock if offline.

import { EventEmitter } from 'events';
import fetch from 'node-fetch';

const NWS_OBS_URL = 'https://api.weather.gov/stations/KSAN/observations/latest';
const REFRESH_MS = 5 * 60 * 1000;

export class WeatherService extends EventEmitter {
  constructor() {
    super();
    this.current = null;
    this.timer = null;
    this.failures = 0;
  }

  async start() {
    await this.refresh();
    this.timer = setInterval(() => this.refresh(), REFRESH_MS);
  }

  async refresh() {
    try {
      const res = await fetch(NWS_OBS_URL, {
        headers: { 'User-Agent': 'marshal-management (hackathon@reboot-the-earth)' },
        timeout: 6000
      });
      if (!res.ok) throw new Error(`NWS ${res.status}`);
      const data = await res.json();
      const p = data.properties || {};
      // NWS reports wind in km/h (unitCode "wmoUnit:km_h-1"); no conversion.
      const w = {
        windDeg: numOr(p.windDirection?.value, 220),
        windKph: numOr(p.windSpeed?.value, 35),
        gustKph: numOr(p.windGust?.value, p.windSpeed?.value ?? 35),
        tempC: numOr(p.temperature?.value, 32),
        humidity: numOr(p.relativeHumidity?.value, 14),
        redFlag: this._redFlagFromObs(p),
        station: 'KSAN',
        source: 'NWS'
      };
      this.current = w;
      this.failures = 0;
      this.emit('update', w);
    } catch (err) {
      this.failures += 1;
      // Fallback: synthetic but realistic. Slowly rotate wind direction to
      // make the demo dynamic.
      const t = Date.now() / 60_000;
      const w = {
        windDeg: Math.round((220 + Math.sin(t / 5) * 25) % 360),
        windKph: 30 + Math.sin(t / 3) * 12,
        gustKph: 50 + Math.sin(t / 3 + 1) * 14,
        tempC: 32,
        humidity: 14,
        redFlag: true,
        station: 'KSAN-MOCK',
        source: 'mock'
      };
      this.current = w;
      this.emit('update', w);
    }
  }

  _redFlagFromObs(p) {
    const windKph = numOr(p.windSpeed?.value, 30);
    const rh = numOr(p.relativeHumidity?.value, 30);
    // Red Flag: sustained wind ≥ 25 km/h AND RH ≤ 25%.
    return windKph >= 25 && rh <= 25;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

function numOr(v, d) {
  return typeof v === 'number' && !Number.isNaN(v) ? v : d;
}
