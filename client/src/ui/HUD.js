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

    document.getElementById('btn-help').addEventListener('click', () => this.showHelp(true));
    document.getElementById('help-close').addEventListener('click', () => this.showHelp(false));
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

    this.timelineSlider.addEventListener('input', () => {
      const target = parseInt(this.timelineSlider.value, 10);
      this.timelineValue.textContent = `T+${target}m`;
      const delta = target - this._simTimeMin;
      if (delta !== 0) {
        this.socket.emit('action', { type: 'time-jump', payload: { deltaMin: delta } });
      }
    });

    this.fireBadge = null;
    this._modeToastTimer = null;
    this._modeToast = this._buildModeToast();
  }

  _buildModeToast() {
    const el = document.createElement('div');
    el.id = 'mode-toast';
    el.className = 'mode-toast hidden';
    document.getElementById('hud').appendChild(el);
    return el;
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
    const m = Math.floor(min);
    const s = Math.floor((min - m) * 60);
    this.timeLabel.textContent = `T+${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    // Keep scrubber thumb in sync so it reads absolute target time
    if (this.timelineSlider && !this.timelineSlider.matches(':active')) {
      this.timelineSlider.value = Math.min(180, Math.round(min));
      this.timelineValue.textContent = `T+${Math.round(min)}m`;
    }
  }

  setPTT(active) {
    this.pttToast.classList.toggle('hidden', !active);
    document.getElementById('btn-ptt').classList.toggle('active', active);
  }

  setFire(f) {
    if (!f) return;
    // Show a compact fire badge in the status bar if not already there.
    if (!this.fireBadge) {
      this.fireBadge = document.createElement('span');
      this.fireBadge.id = 'fire-badge';
      this.fireBadge.style.cssText = 'margin-left:8px;color:var(--accent-hot);font-size:11px;letter-spacing:0.06em;';
      document.getElementById('status-bar').appendChild(this.fireBadge);
    }
    this.fireBadge.textContent = `· 🔥 ${f.burningCells}B ${f.burnedCells}Δ`;
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
