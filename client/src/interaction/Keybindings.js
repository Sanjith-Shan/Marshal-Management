// Keybindings — keyboard fallback for the hardware command board. Mirrors
// the Arduino events so the demo runs identically on a laptop with no
// hardware connected.
//
//   1..4   toggle Weather / Evac / AI / Video panels
//   E      EVACUATE
//   M      cycle mode (MONITOR / COMMAND / EVACUATE)
//   R      reset scenario
//   Space  push-to-talk (hold)
//   T      toggle timeline scrubber
//   ]      jump sim time +30 min   (Shift+] = +60 min)
//   [      jump sim time -30 min   (Shift+[ = -60 min)
//   ?      help overlay

export class Keybindings {
  constructor(socket, hud, voice, panels) {
    this.socket = socket;
    this.hud = hud;
    this.voice = voice;
    this.panels = panels;
    this._pttHeld = false;

    window.addEventListener('keydown', (e) => this._down(e));
    window.addEventListener('keyup', (e) => this._up(e));
  }

  _isInputFocused() {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
  }

  _down(e) {
    if (this._isInputFocused()) return;
    if (e.repeat && e.code !== 'Space') return;
    switch (e.code) {
      case 'Digit1':
        this.socket.emit('action', { type: 'panel', payload: 'weather' }); break;
      case 'Digit2':
        this.socket.emit('action', { type: 'panel', payload: 'evacuation' }); break;
      case 'Digit3':
        this.socket.emit('action', { type: 'panel', payload: 'advisor' }); break;
      case 'Digit4':
        this.socket.emit('action', { type: 'panel', payload: 'video' }); break;
      case 'KeyE':
        this.socket.emit('action', { type: 'evacuate' }); break;
      case 'KeyM':
        this.hud.cycleMode(); break;
      case 'KeyR':
        if (e.shiftKey) this.socket.emit('action', { type: 'reset' });
        else this.socket.emit('action', { type: 'reset' });
        break;
      case 'KeyT':
        this.hud.toggleTimeline(); break;
      case 'KeyP':
        this.socket.emit('action', { type: 'sim:toggle' }); break;
      case 'KeyF':
        // Toggle the historical fire perimeter overlay (NIFC 2003 Cedar etc.)
        if (window.app?.perimeter) {
          const visible = window.app.perimeter.toggle();
          this.hud.showModeToast(visible ? 'Footprint: 2003 Cedar Fire (NIFC) ON' : 'Footprint: OFF');
        }
        break;
      case 'BracketRight':
        this.socket.emit('action', {
          type: 'time-jump',
          payload: { deltaMin: e.shiftKey ? 60 : 30 }
        });
        break;
      case 'BracketLeft':
        this.socket.emit('action', {
          type: 'time-jump',
          payload: { deltaMin: e.shiftKey ? -60 : -30 }
        });
        break;
      case 'Space':
        if (!this._pttHeld) {
          this._pttHeld = true;
          this.socket.emit('action', { type: 'ptt', payload: { active: true } });
          this.hud.setPTT(true);
          this.voice.start();
        }
        e.preventDefault();
        break;
      case 'Slash':
        if (e.shiftKey) this.hud.showHelp(true);
        break;
    }
  }

  _up(e) {
    if (e.code === 'Space') {
      if (this._pttHeld) {
        this._pttHeld = false;
        this.socket.emit('action', { type: 'ptt', payload: { active: false } });
        this.hud.setPTT(false);
        this.voice.stop();
      }
    }
  }
}
