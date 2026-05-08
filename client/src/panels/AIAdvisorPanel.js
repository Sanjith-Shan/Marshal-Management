import { Panel } from './Panel.js';

const VOICE_PREF_KEY = 'mm.advisorVoice';
const speech = (typeof window !== 'undefined') ? window.speechSynthesis : null;

export class AIAdvisorPanel extends Panel {
  constructor(layer, position, socket) {
    super(layer, 'AI STRATEGIC ADVISOR', position);
    this.socket = socket;
    this.voiceEnabled = (typeof localStorage !== 'undefined')
      ? localStorage.getItem(VOICE_PREF_KEY) !== '0'
      : true;
    this._seenIds = new Set();
    this.body.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:6px">
        <button type="button" id="ai-voice-toggle"
                style="background:rgba(255,255,255,0.04);border:1px solid var(--glass-border);border-radius:6px;padding:4px 10px;color:var(--text);font:inherit;font-size:10px;letter-spacing:0.08em;cursor:pointer">
          VOICE: ${this.voiceEnabled ? 'ON' : 'OFF'}
        </button>
      </div>
      <div id="ai-feed" class="advisor-feed"></div>
      <h3>ASK</h3>
      <form id="ai-form" style="display:flex;gap:6px">
        <input type="text" id="ai-input" placeholder="Hold Space to talk, or type…"
               style="flex:1;background:rgba(255,255,255,0.04);border:1px solid var(--glass-border);border-radius:6px;padding:8px;color:var(--text);font:inherit;outline:none;font-size:12px"/>
        <button type="submit" style="background:var(--accent);border:none;border-radius:6px;padding:0 12px;color:var(--bg-0);font-weight:700;cursor:pointer">↩</button>
      </form>
      <div id="ai-status" style="font-size:10px;color:var(--text-dim);letter-spacing:0.08em;margin-top:6px">ready</div>
    `;
    this.feed = this.body.querySelector('#ai-feed');
    this.input = this.body.querySelector('#ai-input');
    this.statusEl = this.body.querySelector('#ai-status');
    this.voiceBtn = this.body.querySelector('#ai-voice-toggle');
    this.voiceBtn.addEventListener('click', () => {
      this.voiceEnabled = !this.voiceEnabled;
      this.voiceBtn.textContent = `VOICE: ${this.voiceEnabled ? 'ON' : 'OFF'}`;
      try { localStorage.setItem(VOICE_PREF_KEY, this.voiceEnabled ? '1' : '0'); } catch {}
      if (!this.voiceEnabled && speech) speech.cancel();
    });
    this.body.querySelector('#ai-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text) return;
      this.statusEl.textContent = 'thinking…';
      this.socket.emit('ai:ask', text);
      this.input.value = '';
    });
  }
  _msgKey(msg) {
    return `${msg.ts || ''}|${msg.source || ''}|${(msg.text || '').slice(0, 64)}`;
  }
  _shouldSpeak(msg) {
    if (!this.voiceEnabled || !speech || !msg?.text) return false;
    if (msg.source === 'system') return false;
    return true;
  }
  _speak(text) {
    if (!speech) return;
    speech.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.pitch = 1.0;
    u.volume = 1.0;
    speech.speak(u);
  }
  setHistory(msgs) {
    this.feed.innerHTML = '';
    for (const m of msgs) {
      this._seenIds.add(this._msgKey(m));
      this.append(m, true);
    }
    this.feed.scrollTop = this.feed.scrollHeight;
  }
  append(msg, batch = false) {
    if (!msg) return;
    const div = document.createElement('div');
    div.className = `advisor-msg ${msg.severity || 'info'}`;
    const ts = new Date(msg.ts || Date.now()).toLocaleTimeString().slice(0, 5);
    const prompt = msg.prompt
      ? `<div style="color:var(--text-dim);font-size:10px;margin-bottom:3px">↳ "${escapeHtml(msg.prompt)}"</div>`
      : '';
    div.innerHTML = `${prompt}${escapeHtml(msg.text || '')}<div style="margin-top:4px"><span class="ts">${ts}</span><span class="src">${(msg.source || '').toUpperCase()}</span></div>`;
    this.feed.appendChild(div);
    while (this.feed.children.length > 40) this.feed.removeChild(this.feed.firstChild);
    if (!batch) this.feed.scrollTop = this.feed.scrollHeight;
    if (this.statusEl) this.statusEl.textContent = `last: ${ts}`;

    // Speak fresh, non-system messages only — `batch` covers history replay.
    if (!batch && this._shouldSpeak(msg)) {
      const key = this._msgKey(msg);
      if (!this._seenIds.has(key)) {
        this._seenIds.add(key);
        this._speak(msg.text);
        if (this._seenIds.size > 200) {
          // bound the dedupe set
          this._seenIds = new Set(Array.from(this._seenIds).slice(-100));
        }
      }
    }
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
