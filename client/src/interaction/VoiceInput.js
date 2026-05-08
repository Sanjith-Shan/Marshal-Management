// VoiceInput — wraps Web Speech API. start() begins listening, stop() ends
// and submits the recognized transcript to the AI advisor. If the API isn't
// available (typed-only fallback), start() returns false silently so the
// caller's PTT key still drives the typed-input path.

export class VoiceInput {
  constructor(socket) {
    this.socket = socket;
    this.recognition = null;
    this.active = false;
    this.transcript = '';
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      this.recognition = new SR();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';
      this.recognition.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) this.transcript += e.results[i][0].transcript + ' ';
          else interim += e.results[i][0].transcript;
        }
        this._setText(this.transcript + interim);
      };
      this.recognition.onerror = (e) => {
        console.warn('[voice] error', e.error);
      };
      this.recognition.onend = () => {
        if (this.active) {
          // Auto-restart while PTT held
          try { this.recognition.start(); } catch (_) {}
        }
      };
    }
  }

  start() {
    if (!this.recognition) {
      this._setText('voice unavailable — type to ask');
      this.active = true;
      return false;
    }
    this.transcript = '';
    this.active = true;
    try { this.recognition.start(); }
    catch (e) { /* already started */ }
    this._setText('Listening…');
    return true;
  }

  stop() {
    this.active = false;
    if (this.recognition) {
      try { this.recognition.stop(); } catch (_) {}
    }
    const final = this.transcript.trim();
    if (final.length > 1) {
      this.socket.emit('ai:ask', final);
    }
    this._setText('');
    this.transcript = '';
  }

  _setText(t) {
    const el = document.getElementById('ptt-text');
    if (el) el.textContent = t || 'Listening…';
  }
}
