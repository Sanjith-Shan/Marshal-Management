import { Panel } from './Panel.js';

export class AIAdvisorPanel extends Panel {
  constructor(layer, position, socket) {
    super(layer, 'AI STRATEGIC ADVISOR', position);
    this.socket = socket;
    this.body.innerHTML = `
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
    this.body.querySelector('#ai-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text) return;
      this.statusEl.textContent = 'thinking…';
      this.socket.emit('ai:ask', text);
      this.input.value = '';
    });
  }
  setHistory(msgs) {
    this.feed.innerHTML = '';
    for (const m of msgs) this.append(m, true);
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
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
