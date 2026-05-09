// PanelManager — owns the four floating panels in DOM (desktop) form.
// Layout is done with simple absolute positioning relative to #panels-layer
// and they're draggable by header. In AR mode this would render as 3D
// panes; for the hackathon demo we keep DOM in AR fallback to web view.

import { WeatherPanel } from './WeatherPanel.js';
import { EvacuationPanel } from './EvacuationPanel.js';
import { AIAdvisorPanel } from './AIAdvisorPanel.js';
import { VideoFeedPanel } from './VideoFeedPanel.js';

export class PanelManager {
  constructor(socket) {
    this.socket = socket;
    this.layer = document.getElementById('panels-layer');
    this.panels = {
      weather: new WeatherPanel(this.layer, { x: 18, y: 18 }),
      evacuation: new EvacuationPanel(this.layer, { x: 18, y: 320 }),
      advisor: new AIAdvisorPanel(this.layer, { x: 'right:18', y: 18 }, socket),
      video: new VideoFeedPanel(this.layer, { x: 'right:18', y: 380 }),
    };
    for (const p of Object.values(this.panels)) p.hide();
    this._wireBottomBar();
  }

  _wireBottomBar() {
    document.querySelectorAll('.ctl-panel').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.panel;
        this.socket.emit('action', { type: 'panel', payload: name });
      });
    });
  }

  applyVisibility(panels) {
    for (const [name, vis] of Object.entries(panels)) {
      const p = this.panels[name];
      if (!p) continue;
      vis ? p.show() : p.hide();
      const btn = document.querySelector(`.ctl-panel[data-panel="${name}"]`);
      if (btn) btn.classList.toggle('active', vis);
    }
  }

  applySnapshot(snap) {
    if (!snap) return;
    if (snap.panels) this.applyVisibility(snap.panels);
    if (snap.weather) this.panels.weather.update(snap.weather);
    if (snap.evacuation) this.panels.evacuation.update(snap.evacuation, snap);
    if (snap.advisorMessages) this.panels.advisor.setHistory(snap.advisorMessages);
  }

  setScenarioContext(scenario) {
    this.panels.evacuation.setHistoricalContext(scenario);
  }

  updateWeather(w) { this.panels.weather.update(w); }
  updateEvacuation(ev) { this.panels.evacuation.update(ev); }

  setHistory(msgs) { this.panels.advisor.setHistory(msgs); }
  appendAdvisor(msg) { this.panels.advisor.append(msg); }
}
