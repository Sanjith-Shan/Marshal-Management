// RouteAnimator — for each zone with an active evacuation route, renders:
//   1. A static glow line (always visible, even from a distance)
//   2. Animated flow particles moving along the primary route
//   3. A dimmer static line for the secondary/alternate route edges
//
// The static line fixes the "route disappears at distance" problem by giving
// a solid reference even when particles are too small to see.

import * as THREE from 'three';
import { chainPolyline } from './_polyline.js';

const PARTICLES_PER_ROUTE = 40;
const SPEED = 0.25;

// Particle sizes calibrated to TERRAIN_WORLD = 9 (session 14 map expansion)
const SIZE_L3 = 0.11;
const SIZE_L2 = 0.09;
const SIZE_L1 = 0.07;

export class RouteAnimator {
  constructor(scenario, terrain) {
    this.scenario = scenario;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'routes';
    this.routes = new Map();
    this._lastSnap = null;
    this._evacMode = false;
    // Routes recomputed by the engine fade old → new instead of snapping,
    // so the marshal can visually track the change after blocking a road.
    this._fadingOut = [];
    this._FADE_MS = 600;
  }

  setEvacMode(active) {
    this._evacMode = active;
    for (const r of this.routes.values()) {
      const baseSize    = r.level === 3 ? SIZE_L3 : r.level === 2 ? SIZE_L2 : SIZE_L1;
      const baseOpacity = r.level >= 2 ? 0.95 : 0.6;
      r.points.material.size = active ? baseSize * 1.5 : baseSize;
      // Update target opacities so any in-progress fade lerps to the
      // mode-correct values, then snap current opacity to the target so
      // a mode change is instantaneous (it's a discrete UX event).
      r.targetPointsOp  = active ? 1.0  : baseOpacity;
      r.targetLineOp    = active ? 0.55 : 0.35;
      r.targetSecLineOp = active ? 0.30 : 0.18;
      r.points.material.opacity = r.targetPointsOp;
      if (r.line)    r.line.material.opacity    = r.targetLineOp;
      if (r.secLine) r.secLine.material.opacity = r.targetSecLineOp;
      r.fadeInStart = null;
      r.points.material.needsUpdate = true;
      if (r.line)    r.line.material.needsUpdate    = true;
      if (r.secLine) r.secLine.material.needsUpdate = true;
    }
  }

  applySnapshot(snap) {
    this._lastSnap = snap;
    if (!snap?.evacuation?.zones) return;

    // Move existing routes to fade-out instead of disposing immediately.
    const fadeStart = performance.now();
    for (const r of this.routes.values()) {
      this._fadingOut.push({
        points: r.points,
        line: r.line,
        secLine: r.secLine,
        startTime: fadeStart,
        pointsStart:  r.points?.material.opacity ?? 0,
        lineStart:    r.line?.material.opacity ?? 0,
        secLineStart: r.secLine?.material.opacity ?? 0,
      });
    }
    this.routes.clear();

    for (const z of snap.evacuation.zones) {
      if (!z.route?.edgeIds) continue;
      const path = this._edgesToPolyline(z.route.edgeIds);
      if (path.length < 2) continue;

      const cumLen = [0];
      let total = 0;
      for (let i = 1; i < path.length; i++) {
        total += path[i].distanceTo(path[i - 1]);
        cumLen.push(total);
      }

      const color = z.level === 3 ? 0x66ff99 : z.level === 2 ? 0xfff088 : 0x88ccdd;
      const baseSize    = z.level === 3 ? SIZE_L3 : z.level === 2 ? SIZE_L2 : SIZE_L1;
      const baseOpacity = z.level >= 2 ? 0.95 : 0.6;

      // Target opacities — `update()` lerps from 0 to these over _FADE_MS.
      const targetPointsOp  = this._evacMode ? 1.0 : baseOpacity;
      const targetLineOp    = this._evacMode ? 0.55 : 0.35;
      const targetSecLineOp = this._evacMode ? 0.30 : 0.18;

      // --- Static glow line (primary route backbone) — start at 0 opacity ---
      const line = this._makeLine(path, color, 0, 5);

      // --- Animated flow particles — start at 0 opacity ---
      const partCount = z.level === 3 ? PARTICLES_PER_ROUTE
                      : z.level === 2 ? Math.round(PARTICLES_PER_ROUTE * 0.65)
                      : Math.round(PARTICLES_PER_ROUTE * 0.3);
      const positions = new Float32Array(partCount * 3);
      const phases    = new Float32Array(partCount);
      for (let i = 0; i < partCount; i++) phases[i] = Math.random();

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({
        color,
        size:    this._evacMode ? baseSize * 1.5 : baseSize,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      });
      const pts = new THREE.Points(geom, mat);
      pts.renderOrder = 6;

      let secLine = null;
      if (z.route.secondaryEdgeIds?.length) {
        const secPath = this._edgesToPolyline(z.route.secondaryEdgeIds);
        if (secPath.length >= 2) {
          secLine = this._makeLine(secPath, 0x4488ff, 0, 4);
        }
      }

      this.group.add(line);
      if (secLine) this.group.add(secLine);
      this.group.add(pts);

      this.routes.set(z.name, {
        path, cumLen, total, phases, positions, count: partCount,
        geometry: geom, points: pts, line, secLine, level: z.level,
        fadeInStart: fadeStart,
        targetPointsOp, targetLineOp, targetSecLineOp,
      });
    }
  }

  _makeLine(path, color, opacity, renderOrder) {
    const verts = new Float32Array(path.length * 3);
    for (let i = 0; i < path.length; i++) {
      verts[i * 3 + 0] = path[i].x;
      verts[i * 3 + 1] = path[i].y;
      verts[i * 3 + 2] = path[i].z;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const line = new THREE.Line(geom, mat);
    line.renderOrder = renderOrder;
    return line;
  }

  _edgesToPolyline(edgeIds) {
    return chainPolyline(
      edgeIds, this.scenario.edges, this.scenario.nodes,
      (gx, gz, h) => this.terrain.gridToWorld(gx, gz, h),
      0.04, 4
    );
  }

  update(dt) {
    const now = performance.now();
    const t = now / 1000;

    // Drive fade-outs of routes superseded by the latest applySnapshot.
    if (this._fadingOut.length) {
      this._fadingOut = this._fadingOut.filter(f => {
        const elapsed = now - f.startTime;
        if (elapsed >= this._FADE_MS) {
          if (f.points) {
            this.group.remove(f.points);
            f.points.geometry.dispose();
            f.points.material.dispose();
          }
          if (f.line) {
            this.group.remove(f.line);
            f.line.geometry.dispose();
            f.line.material.dispose();
          }
          if (f.secLine) {
            this.group.remove(f.secLine);
            f.secLine.geometry.dispose();
            f.secLine.material.dispose();
          }
          return false;
        }
        const k = 1 - (elapsed / this._FADE_MS);
        if (f.points)  f.points.material.opacity  = f.pointsStart  * k;
        if (f.line)    f.line.material.opacity    = f.lineStart    * k;
        if (f.secLine) f.secLine.material.opacity = f.secLineStart * k;
        return true;
      });
    }

    for (const route of this.routes.values()) {
      // Drive fade-in for newly-built routes.
      if (route.fadeInStart != null) {
        const elapsed = now - route.fadeInStart;
        if (elapsed >= this._FADE_MS) {
          route.points.material.opacity = route.targetPointsOp;
          if (route.line)    route.line.material.opacity    = route.targetLineOp;
          if (route.secLine) route.secLine.material.opacity = route.targetSecLineOp;
          route.fadeInStart = null;
        } else {
          const k = elapsed / this._FADE_MS;
          route.points.material.opacity = route.targetPointsOp * k;
          if (route.line)    route.line.material.opacity    = route.targetLineOp    * k;
          if (route.secLine) route.secLine.material.opacity = route.targetSecLineOp * k;
        }
      }

      // Per-frame particle position update (unchanged).
      const { path, cumLen, total, phases, positions, geometry, count, level } = route;
      const speedMult = this._evacMode ? 1.5 : 1.0;
      const speed = speedMult * (level === 3 ? SPEED * 1.4 : level === 2 ? SPEED : SPEED * 0.6);
      for (let i = 0; i < count; i++) {
        let p = (phases[i] + t * speed / total) % 1;
        const targetLen = p * total;
        let lo = 0, hi = cumLen.length - 1;
        while (lo + 1 < hi) {
          const mid = (lo + hi) >> 1;
          if (cumLen[mid] < targetLen) lo = mid; else hi = mid;
        }
        const segLen = cumLen[hi] - cumLen[lo];
        const f = segLen > 0 ? (targetLen - cumLen[lo]) / segLen : 0;
        const A = path[lo], B = path[hi];
        positions[i * 3 + 0] = A.x + (B.x - A.x) * f;
        positions[i * 3 + 1] = A.y + (B.y - A.y) * f + 0.005 * Math.sin(t * 4 + i);
        positions[i * 3 + 2] = A.z + (B.z - A.z) * f;
      }
      geometry.attributes.position.needsUpdate = true;
    }
  }
}
