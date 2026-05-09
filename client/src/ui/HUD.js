// HUD — owns the top-bar status, mode label, sim clock, EVACUATE button
// state, push-to-talk toast, help overlay, timeline scrubber.

export class HUD {
  constructor(socket, panels) {
    this.socket = socket;
    this.panels = panels;
    this.connDot = document.getElementById('conn-dot');
    this.connLabel = document.getElementById('conn-label');
    this.modeLabel = document.getElementById('mode-label');
    this.timeLabel = document.getElementById('time-label');
    this.pttToast = document.getElementById('ptt-toast');
    this.timeline = document.getElementById('timeline');
    this.timelineSlider = document.getElementById('timeline-slider');
    this.timelineValue = document.getElementById('timeline-value');
    this._simTimeMin = 0;      // tracked so slider can compute time-jump delta
    this._scenarioStartTotalMin = 17 * 60 + 37;  // default Cedar 2003 ignition (17:37)

    document.getElementById('btn-help').addEventListener('click', () => this.showHelp(true));
    document.getElementById('help-close').addEventListener('click', () => {
      this.showHelp(false);
      try { localStorage.setItem('mm.helpSeen', '1'); } catch {}
    });
    // Auto-show on first launch so judges know what they're looking at.
    try {
      const seen = localStorage.getItem('mm.helpSeen') === '1';
      if (!seen) {
        // Defer briefly so the scene appears behind the overlay first.
        setTimeout(() => this.showHelp(true), 600);
      }
    } catch {}
    document.getElementById('btn-evacuate').addEventListener('click', () => {
      this.socket.emit('action', { type: 'evacuate' });
    });
    document.getElementById('btn-reset').addEventListener('click', () => {
      this.socket.emit('action', { type: 'reset' });
    });
    document.getElementById('btn-mode').addEventListener('click', () => this.cycleMode());
    document.getElementById('btn-time-fwd').addEventListener('click', (e) => {
      this.socket.emit('action', {
        type: 'time-jump',
        payload: { deltaMin: e.shiftKey ? 60 : 30 }
      });
    });
    document.getElementById('btn-time-back').addEventListener('click', (e) => {
      this.socket.emit('action', {
        type: 'time-jump',
        payload: { deltaMin: e.shiftKey ? -60 : -30 }
      });
    });
    document.getElementById('btn-pause').addEventListener('click', () => {
      this.socket.emit('action', { type: 'sim:toggle' });
    });

    this.timelineSlider.addEventListener('input', () => {
      const target = parseInt(this.timelineSlider.value, 10);
      this.timelineValue.textContent = `T+${target}m`;
      const delta = target - this._simTimeMin;
      if (delta !== 0) {
        this.socket.emit('action', { type: 'time-jump', payload: { deltaMin: delta } });
      }
    });

    this.fireBadge = null;
    this.firmsBadge = null;
    this._modeToastTimer = null;
    this._modeToast = this._buildModeToast();

    this.scenarioPicker = document.getElementById('scenario-picker');
    this._wireScenarioPicker();
  }

  async _wireScenarioPicker() {
    if (!this.scenarioPicker) return;
    try {
      const res = await fetch('/api/scenarios');
      const data = await res.json();
      this.scenarioPicker.innerHTML = data.available
        .map(s => `<option value="${s.id}">${s.name}</option>`)
        .join('');
      if (data.current) this.scenarioPicker.value = data.current;
      this.scenarioPicker.addEventListener('change', () => {
        this.socket.emit('action', {
          type: 'reset',
          payload: { scenarioId: this.scenarioPicker.value }
        });
      });
    } catch (err) {
      console.warn('[hud] scenario list fetch failed:', err.message);
    }
  }

  setScenario(id) {
    if (this.scenarioPicker && id && this.scenarioPicker.value !== id) {
      this.scenarioPicker.value = id;
    }
  }

  _buildModeToast() {
    const el = document.createElement('div');
    el.id = 'mode-toast';
    el.className = 'mode-toast hidden';
    document.getElementById('hud').appendChild(el);
    return el;
  }

  setEvacBannerVisible(visible) {
    const el = document.getElementById('evac-banner');
    if (!el) return;
    el.classList.toggle('hidden', !visible);
  }

  updateEvacBanner(snap) {
    const el = document.getElementById('evac-banner-stats');
    if (!el) return;
    const ev = snap?.evacuation;
    if (!ev?.zones) return;
    const total = ev.totalPopulation || 0;
    const evacuated = Math.round(ev.zones.reduce((a, z) => {
      const zonePop = (snap.populations || []).filter(p => p.zone === z.name).reduce((s, p) => s + p.count, 0);
      return a + ((z.evacuatedPct || 0) / 100) * zonePop;
    }, 0));
    const evacPct = total > 0 ? Math.round(evacuated / total * 100) : 0;
    const worst = ev.zones.slice().sort((a, b) => (a.marginMin ?? 9999) - (b.marginMin ?? 9999))[0];
    const bnCount = ev.bottlenecks?.length || 0;
    const margin = worst?.marginMin;
    const marginCls = margin == null ? '' : margin < 0 ? 'crit' : margin < 15 ? 'warn' : '';
    el.innerHTML = `
      <span>${total.toLocaleString()} residents</span> ·
      <span class="${evacPct >= 60 ? '' : 'warn'}">${evacPct}% evacuated</span> ·
      <span>Critical: <span class="${marginCls}">${worst?.name || '—'} ${margin != null ? margin + 'm margin' : ''}</span></span> ·
      <span class="${bnCount ? 'warn' : ''}">${bnCount} bottlenecks</span>
    `;

    const hintEl = document.getElementById('evac-banner-hint');
    if (hintEl) hintEl.textContent = _evacuationHint(ev, snap.weather);
  }

  showModeToast(mode) {
    const descriptions = {
      MONITOR:  'Monitor Mode — observation only',
      COMMAND:  'Command Mode — click roads to block · voice commands active',
      EVACUATE: 'Evacuation Mode — routing panel open · press E to recompute'
    };
    const colors = {
      MONITOR:  'var(--accent)',
      COMMAND:  'var(--accent-warm)',
      EVACUATE: 'var(--accent-hot)'
    };
    this._modeToast.textContent = descriptions[mode] || mode;
    this._modeToast.style.borderColor = colors[mode] || 'var(--accent)';
    this._modeToast.style.color = colors[mode] || 'var(--accent)';
    this._modeToast.classList.remove('hidden');
    clearTimeout(this._modeToastTimer);
    this._modeToastTimer = setTimeout(() => this._modeToast.classList.add('hidden'), 2500);
  }

  setConnection(connected) {
    if (connected) {
      this.connDot.classList.add('connected');
      this.connDot.classList.remove('disconnected');
      this.connLabel.textContent = 'live';
    } else {
      this.connDot.classList.remove('connected');
      this.connDot.classList.add('disconnected');
      this.connLabel.textContent = 'reconnecting…';
    }
  }

  setSimRunning(running) {
    const btn = document.getElementById('btn-pause');
    if (!btn) return;
    btn.innerHTML = running
      ? '<kbd>P</kbd> Pause'
      : '<kbd>P</kbd> Resume';
    btn.classList.toggle('paused', !running);
  }

  setMode(mode) {
    this.modeLabel.textContent = mode;
    this.modeLabel.style.color = mode === 'COMMAND' ? 'var(--accent-warm)'
                              : mode === 'EVACUATE' ? 'var(--accent-hot)'
                              : 'var(--accent)';
    this.showModeToast(mode);
  }

  cycleMode() {
    const cur = this.modeLabel.textContent;
    const next = cur === 'MONITOR' ? 'COMMAND' : cur === 'COMMAND' ? 'EVACUATE' : 'MONITOR';
    this.socket.emit('action', { type: 'mode', payload: next });
  }

  setSimTime(min) {
    this._simTimeMin = min;
    // Military time: scenario ignition + simulated minutes elapsed, in HH:MM.
    const total = (this._scenarioStartTotalMin + Math.floor(min) + 24 * 60) % (24 * 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    this.timeLabel.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (this.timelineSlider && !this.timelineSlider.matches(':active')) {
      this.timelineSlider.value = Math.min(180, Math.round(min));
      this.timelineValue.textContent = `+${Math.round(min)}m`;
    }
  }

  setScenarioStart(meta) {
    if (!meta?.ignitionTime) {
      this._scenarioStartTotalMin = 17 * 60 + 37;   // Cedar 2003 default
      return;
    }
    const m = String(meta.ignitionTime).match(/(\d{1,2}):(\d{2})/);
    if (m) {
      this._scenarioStartTotalMin = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    }
  }

  setPTT(active) {
    this.pttToast.classList.toggle('hidden', !active);
    document.getElementById('btn-ptt').classList.toggle('active', active);
  }

  setWindStatus(w) {
    const el = document.getElementById('wind-status');
    if (!el || !w) return;
    const mph = Math.round(w.windKph * 0.621371);
    const from = _cardinal(w.windDeg);
    const toward = _windLabel(w.windDeg);
    el.textContent = `${from}→${toward} ${mph} mph`;
    el.title = `Wind from ${from} at ${mph} mph · fire moving ${toward}`;
    el.style.color = w.redFlag ? 'var(--accent-hot)' : 'var(--accent)';
  }

  setFire(f) {
    if (!f) return;
    if (!this.fireBadge) {
      this.fireBadge = document.createElement('span');
      this.fireBadge.id = 'fire-badge';
      this.fireBadge.style.cssText = 'margin-left:8px;color:var(--accent-hot);font-size:11px;letter-spacing:0.06em;';
      document.getElementById('status-bar').appendChild(this.fireBadge);
    }
    this.fireBadge.textContent = `· 🔥 ${f.burningCells}B ${f.burnedCells}Δ`;
  }

  setFirms(data) {
    if (!data) return;
    if (!this.firmsBadge) {
      this.firmsBadge = document.createElement('span');
      this.firmsBadge.id = 'firms-badge';
      this.firmsBadge.title = 'NASA FIRMS — live California wildfire hotspots (last 24 h)';
      this.firmsBadge.style.cssText = 'margin-left:8px;color:var(--accent-warm);font-size:11px;letter-spacing:0.06em;';
      document.getElementById('status-bar').appendChild(this.firmsBadge);
    }
    if (data.available && data.count != null) {
      this.firmsBadge.textContent = `· 🛰 ${data.count} CA hotspots`;
    } else {
      this.firmsBadge.textContent = '';
    }
  }

  setRealDataBadge(scn) {
    if (!scn) return;
    if (!this.realBadge) {
      this.realBadge = document.createElement('span');
      this.realBadge.id = 'real-data-badge';
      this.realBadge.title = 'Real-world data sources active for this scenario';
      this.realBadge.style.cssText = 'margin-left:8px;color:var(--accent-good);font-size:11px;letter-spacing:0.06em;';
      document.getElementById('status-bar').appendChild(this.realBadge);
    }
    const parts = [];
    if (scn.realRoads)   parts.push('OSM');
    if (scn.realTerrain) parts.push('3DEP');
    this.realBadge.textContent = parts.length ? `· 🌐 ${parts.join('+')}` : '';
  }

  applySnapshot(snap) {
    if (!snap) return;
    this.setMode(snap.mode || 'MONITOR');
    this.setSimTime(snap.simTimeMin || 0);
    if (snap.timelineMin && this.timelineSlider) {
      this.timelineSlider.value = snap.timelineMin;
      this.timelineValue.textContent = `+${snap.timelineMin} min`;
    }
    document.getElementById('btn-evacuate').classList.toggle(
      'armed', snap.evacuation && snap.evacuation.zones?.some(z => z.level === 3)
    );
  }

  showHelp(b) {
    document.getElementById('help-overlay').classList.toggle('hidden', !b);
  }

  toggleTimeline() {
    this.timeline.classList.toggle('hidden');
  }
}

function _evacuationHint(ev, weather) {
  const noRoute = ev.zones.find(z => !z.route && z.level >= 2);
  if (noRoute) return `⚡ ${noRoute.name} has no route — press M → COMMAND, unblock roads or voice: "Contraflow I-15"`;

  const overload = ev.zones.find(z => z.bottleneck && z.bottleneck.ratio > 100);
  if (overload) {
    const worstZone = ev.zones.slice().sort((a, b) => (b.bottleneck?.ratio || 0) - (a.bottleneck?.ratio || 0))[0];
    return `Route overloaded in ${overload.name} — voice: "Contraflow I-15" or click zone to cycle level`;
  }

  const critical = ev.zones.find(z => z.level < 3 && z.marginMin < 15 && z.marginMin >= 0);
  if (critical) return `⚡ ${critical.name} margin ${critical.marginMin}m — click zone or voice: "Upgrade ${critical.name} to GO"`;

  const windLabel = weather ? _windLabel(weather.windDeg) : '';
  const windCardinal = weather ? ` (${_cardinal(weather.windDeg)} → ${_windLabel(weather.windDeg)})` : '';
  const redFlag = weather?.redFlag ? ' · 🚩 RED FLAG' : '';
  return `Fire moving ${windLabel}${redFlag} · Click zone to cycle level · Voice: "Upgrade [Zone] to GO"`;
}

function _windLabel(windDeg) {
  const toward = (windDeg + 180) % 360;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(toward / 45) % 8];
}

function _cardinal(windDeg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(windDeg / 22.5) % 16];
}
