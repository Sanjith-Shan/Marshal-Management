// ProactiveOverlay — when the AI proactive scan flags a critical or warning
// condition for a zone, this renderer hovers a pulsing warning triangle
// above that zone's centroid for ~8 seconds. Makes the AI feel agentic:
// instead of just text in a panel, the user sees the zone the AI is
// concerned about.

import * as THREE from 'three';

const LIFETIME_S = 8.0;
const HOVER_HEIGHT = 0.45;

export class ProactiveOverlay {
  constructor(scenario, terrain) {
    this.scenario = scenario;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'proactive-overlay';
    this.zoneCentroids = this._computeCentroids();
    this.active = new Map();   // zoneName -> { mesh, born, severity }
  }

  _computeCentroids() {
    const byZone = new Map();
    for (const p of this.scenario.populations) {
      const n = this.scenario.nodes[p.nodeId];
      if (!byZone.has(p.zone)) byZone.set(p.zone, []);
      byZone.get(p.zone).push(n);
    }
    const out = new Map();
    for (const [zone, nodes] of byZone) {
      let sx = 0, sy = 0;
      for (const n of nodes) { sx += n.x; sy += n.z; }
      sx /= nodes.length; sy /= nodes.length;
      out.set(zone, this.terrain.gridToWorld(sx, sy, HOVER_HEIGHT));
    }
    return out;
  }

  // Called when an advisor message arrives with a zoneName + severity.
  notify(msg) {
    if (!msg?.zoneName) return;
    if (msg.severity !== 'crit' && msg.severity !== 'warn') return;
    const center = this.zoneCentroids.get(msg.zoneName);
    if (!center) return;

    // Replace any existing marker for this zone (refresh lifetime)
    const prev = this.active.get(msg.zoneName);
    if (prev) {
      this.group.remove(prev.mesh);
      prev.mesh.geometry.dispose();
      prev.mesh.material.map?.dispose();
      prev.mesh.material.dispose();
    }

    const mesh = this._buildMarker(msg.severity);
    mesh.position.copy(center);
    this.group.add(mesh);
    this.active.set(msg.zoneName, {
      mesh,
      born: performance.now() / 1000,
      severity: msg.severity
    });
  }

  _buildMarker(severity) {
    // Canvas-textured plane that billboards toward camera in update()
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const color = severity === 'crit' ? '#ff5f5f' : '#ffb86b';

    // Triangle with bang
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(20,10,5,0.85)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(64, 14);
    ctx.lineTo(118, 110);
    ctx.lineTo(10, 110);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(20,10,5,0.95)';
    ctx.font = 'bold 64px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', 64, 70);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), mat);
    mesh.renderOrder = 12;
    return mesh;
  }

  update(dt, camera) {
    const now = performance.now() / 1000;
    const toRemove = [];
    for (const [zone, rec] of this.active) {
      const age = now - rec.born;
      if (age >= LIFETIME_S) { toRemove.push(zone); continue; }
      // Pulse + slight bob
      const t = age * 5;
      const scale = 1.0 + 0.25 * Math.sin(t);
      rec.mesh.scale.setScalar(scale);
      rec.mesh.position.y += Math.sin(t * 0.7) * 0.0008;
      // Fade in first 0.3s, fade out last 1.0s
      const fadeIn  = Math.min(1, age / 0.3);
      const fadeOut = Math.min(1, (LIFETIME_S - age) / 1.0);
      rec.mesh.material.opacity = Math.min(fadeIn, fadeOut);
      if (camera) rec.mesh.lookAt(camera.position);
    }
    for (const zone of toRemove) {
      const rec = this.active.get(zone);
      this.group.remove(rec.mesh);
      rec.mesh.geometry.dispose();
      rec.mesh.material.map?.dispose();
      rec.mesh.material.dispose();
      this.active.delete(zone);
    }
  }
}
