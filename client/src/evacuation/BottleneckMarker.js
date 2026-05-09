// BottleneckMarker — vertical billboard warning signs at the midpoint of any
// road segment where evacuation flow exceeds 55% of hourly capacity.
//
// Each sign shows:
//   ⚠ BOTTLENECK  (header, red if >100% cap, amber if 55-100%)
//   [capacity bar]
//   Road class + capacity %
//   Action hint (enable contraflow)
//
// Signs billboard toward the camera so they're readable from any angle.
// Severity drives size: worst bottleneck = tallest sign.

import * as THREE from 'three';

const HWY_LABEL = {
  motorway: 'I-15 (motorway)',
  trunk:    'SR-67 (trunk)',
  primary:  'primary road',
  secondary:'secondary road',
  residential: 'residential',
};

export class BottleneckMarker {
  constructor(scenario, terrain) {
    this.scenario = scenario;
    this.terrain  = terrain;
    this.group    = new THREE.Group();
    this.group.name = 'bottlenecks';
    this.markers  = [];
    this._evacMode = false;
  }

  setEvacMode(active) {
    this._evacMode = active;
  }

  applySnapshot(snap) {
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    this.markers = [];
    if (!snap?.evacuation?.bottlenecks) return;

    for (const b of snap.evacuation.bottlenecks) {
      const e = this.scenario.edges.find(x => x.id === b.edgeId);
      if (!e) continue;
      const A = this.scenario.nodes[e.u];
      const B = this.scenario.nodes[e.v];
      const mid = this.terrain.gridToWorld((A.x + B.x) / 2, (A.z + B.z) / 2, 0.08);

      const pct    = Math.round(b.ratio * 100);
      const isCrit = b.ratio >= 1.0;
      const label  = HWY_LABEL[e.hwy] || e.hwy || 'road';
      const scale  = 0.9 + Math.min(b.ratio, 2.0) * 0.25;  // bigger = worse

      const billboard = this._makeBillboard(pct, label, isCrit, e.hwy);
      billboard.position.copy(mid);
      billboard.position.y += 0.18 * scale;
      billboard.scale.setScalar(scale);
      billboard.renderOrder = 9;
      this.group.add(billboard);

      // Subtle vertical stem connecting billboard to road surface
      const stemGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(mid.x, mid.y, mid.z),
        new THREE.Vector3(mid.x, mid.y + 0.18 * scale, mid.z),
      ]);
      const stem = new THREE.Line(stemGeo, new THREE.LineBasicMaterial({
        color: isCrit ? 0xff4040 : 0xffa040,
        transparent: true, opacity: 0.5
      }));
      stem.renderOrder = 8;
      this.group.add(stem);

      this.markers.push({ billboard, stem, isCrit, ratio: b.ratio });
    }
  }

  _makeBillboard(pct, label, isCrit, hwyType) {
    const W = 256, H = 100;
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Background
    const bg = isCrit ? 'rgba(200,30,30,0.92)' : 'rgba(190,100,0,0.92)';
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 8);
    ctx.fill();

    // Top stripe: warning icon + BOTTLENECK label
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, W, 32);
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚠', 10, 16);
    ctx.font = 'bold 14px monospace';
    ctx.fillText('BOTTLENECK', 36, 16);

    // Capacity % (large)
    ctx.font = 'bold 22px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.fillText(`${pct}%`, W - 10, 16);

    // Capacity bar
    const barY = 38, barH = 10, barW = W - 20;
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(10, barY, barW, barH);
    const fill = Math.min(pct / 200, 1);  // bar saturates at 200%
    ctx.fillStyle = isCrit ? '#ff6060' : '#ffcc60';
    ctx.fillRect(10, barY, barW * fill, barH);

    // Road label
    ctx.font = '12px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.textAlign = 'left';
    ctx.fillText(label, 10, 64);

    // Action hint
    const hint = hwyType === 'motorway' ? '→ "Contraflow I-15"'
               : hwyType === 'trunk'    ? '→ "Contraflow SR-67"'
               : '→ Enable contraflow';
    ctx.font = '11px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(hint, 10, 84);

    const tex = new THREE.CanvasTexture(canvas);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.52, 0.205),   // world-space size
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide })
    );
    return mesh;
  }

  update(dt, camera) {
    const t = performance.now();
    for (const m of this.markers) {
      if (camera) m.billboard.lookAt(camera.position);
      // Pulse opacity: crit flashes faster
      const period = (this._evacMode || m.isCrit) ? 350 : 600;
      const pulse  = 0.75 + 0.25 * Math.abs(Math.sin(t / period));
      m.billboard.material.opacity = pulse;
    }
  }
}
