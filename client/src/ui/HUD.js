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

    document.getElementById('btn-help').addEventListener('click', () => this.showHelp(true));
    document.getElementById('help-close').addEventListener('click', () => this.showHelp(false));
    document.getElementById('btn-evacuate').addEventListener('click', () => {
      this.socket.emit('action', { type: 'evacuate' });
    });
    document.getElementById('btn-reset').addEventListener('click', () => {
      this.socket.emit('action', { type: 'reset' });
    });
    document.getElementById('btn-mode').addEventListener('click', () => this.cycleMode());

    this.timelineSlider.addEventListener('input', () => {
      const v = parseInt(this.timelineSlider.value, 10);
      this.timelineValue.textContent = `+${v} min`;
      this.socket.emit('action', { type: 'timeline', payload: { minutes: v } });
    });

    this.fireBadge = null;
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
  }

  cycleMode() {
    const cur = this.modeLabel.textContent;
    const next = cur === 'MONITOR' ? 'COMMAND' : cur === 'COMMAND' ? 'EVACUATE' : 'MONITOR';
    this.socket.emit('action', { type: 'mode', payload: next });
  }

  setSimTime(min) {
    const m = Math.floor(min);
    const s = Math.floor((min - m) * 60);
    this.timeLabel.textContent = `T+${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  setPTT(active) {
    this.pttToast.classList.toggle('hidden', !active);
    document.getElementById('btn-ptt').classList.toggle('active', active);
  }

  setFire(f) {
    // No dedicated fire HUD in v1, but we could add a fire perimeter readout
    // here if desired.
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
