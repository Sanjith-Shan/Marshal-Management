// VideoFeedPanel — 4 simulated "field camera" tiles. Each tile renders an
// animated procedural canvas so the demo doesn't require any real video files.

import { Panel } from './Panel.js';

const FEEDS = [
  { label: 'CAM-01 Scripps Ranch · Pole', tone: 'smoke' },
  { label: 'CAM-02 Poway Rd · Mile 4', tone: 'flame' },
  { label: 'CAM-03 SR-67 Lookout', tone: 'smoke' },
  { label: 'CAM-04 Ramona East', tone: 'sky' },
];

export class VideoFeedPanel extends Panel {
  constructor(layer, position) {
    super(layer, 'VIDEO FEEDS · LIVE', position);
    this.tiles = [];
    this.body.innerHTML = `<div class="video-grid" id="vid-grid"></div>`;
    const grid = this.body.querySelector('#vid-grid');
    for (const f of FEEDS) {
      const tile = document.createElement('div');
      tile.className = 'video-tile';
      tile.innerHTML = `<canvas></canvas><div class="label">${f.label}</div><div class="live">LIVE</div>`;
      grid.appendChild(tile);
      const canvas = tile.querySelector('canvas');
      this.tiles.push({ canvas, ctx: canvas.getContext('2d'), tone: f.tone, t: Math.random() * 100 });
    }
    this._loop();
  }
  _loop() {
    const draw = () => {
      for (const tile of this.tiles) {
        if (!this.isVisible()) continue;
        this._drawTile(tile);
      }
      this._raf = requestAnimationFrame(draw);
    };
    draw();
  }
  _drawTile(tile) {
    const { canvas, ctx, tone } = tile;
    const w = canvas.clientWidth || 200;
    const h = canvas.clientHeight || 130;
    if (canvas.width !== w * 2 || canvas.height !== h * 2) {
      canvas.width = w * 2;
      canvas.height = h * 2;
      ctx.scale(2, 2);
    }
    tile.t += 0.02;
    const t = tile.t;
    // Sky / horizon
    let skyTop, skyBot, ground;
    if (tone === 'flame') { skyTop = '#3a0a05'; skyBot = '#7a1a0a'; ground = '#1a0a08'; }
    else if (tone === 'smoke') { skyTop = '#3a3027'; skyBot = '#5e4d3a'; ground = '#2a2018'; }
    else { skyTop = '#2a3340'; skyBot = '#5d6a7c'; ground = '#1c2028'; }
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, skyTop);
    grad.addColorStop(0.6, skyBot);
    grad.addColorStop(1, ground);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Hills silhouette
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 6) {
      const yh = h * 0.55 + Math.sin(x * 0.04 + t * 0.4) * 12 + Math.sin(x * 0.13) * 6;
      ctx.lineTo(x, yh);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    // Smoke / flame plumes
    if (tone === 'flame' || tone === 'smoke') {
      for (let i = 0; i < 18; i++) {
        const x = ((i * 23 + t * 18) % w);
        const y = h * 0.4 - i * 2;
        const r = 30 + Math.sin(t + i) * 10;
        const grad2 = ctx.createRadialGradient(x, y, 2, x, y, r);
        if (tone === 'flame') {
          grad2.addColorStop(0, 'rgba(255,180,80,0.45)');
          grad2.addColorStop(1, 'rgba(60,20,10,0)');
        } else {
          grad2.addColorStop(0, 'rgba(180,160,140,0.35)');
          grad2.addColorStop(1, 'rgba(60,50,40,0)');
        }
        ctx.fillStyle = grad2;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Scanline
    ctx.fillStyle = `rgba(0,0,0,${0.04 + 0.03 * Math.sin(t * 4)})`;
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);

    // Timestamp
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(108,207,255,0.85)';
    const now = new Date();
    ctx.fillText(now.toLocaleTimeString(), w - 56, h - 6);
  }
}
