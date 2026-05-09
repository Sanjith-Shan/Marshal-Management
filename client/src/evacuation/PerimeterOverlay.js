// PerimeterOverlay — draws the real historical fire perimeter (NIFC 2003
// Cedar / 2007 Witch Creek) on the terrain as a translucent shape with
// a bright outline. Toggles via the F key (and a HUD button).
//
// Demo line: "this is what actually burned in 2003 — and here's our sim
// at the same simulated minute. Within X% of the real footprint."

import * as THREE from 'three';

const FILL_COLOR    = 0xff5544;   // historical-burn red
const OUTLINE_COLOR = 0xffaa66;
const FILL_OPACITY  = 0.18;
const LIFT          = 0.06;       // above terrain to avoid z-fighting

export class PerimeterOverlay {
  constructor(scenario, terrain) {
    this.scenario = scenario;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'perimeter-overlay';
    this._visible = false;
    this.group.visible = false;
    this._build();
  }

  _build() {
    const perim = this.scenario.historicalPerimeter;
    if (!perim?.polygons?.length) return;

    for (const poly of perim.polygons) {
      if (poly.length < 3) continue;

      // Convert grid points to world Vector2 (xz plane). Skip duplicate
      // consecutive points so Shape doesn't choke.
      const points = [];
      let prev = null;
      for (const p of poly) {
        const v = this.terrain.gridToWorld(p.gx, p.gy, LIFT);
        if (!prev || (Math.abs(v.x - prev.x) > 0.0005 || Math.abs(v.z - prev.z) > 0.0005)) {
          points.push(new THREE.Vector2(v.x, v.z));
          prev = v;
        }
      }
      if (points.length < 3) continue;

      const shape = new THREE.Shape(points);
      const fillGeom = new THREE.ShapeGeometry(shape);
      // ShapeGeometry produces XY plane; rotate to XZ.
      fillGeom.rotateX(Math.PI / 2);
      // Lift to avoid z-fighting with terrain.
      fillGeom.translate(0, LIFT, 0);

      const fill = new THREE.Mesh(
        fillGeom,
        new THREE.MeshBasicMaterial({
          color: FILL_COLOR,
          transparent: true,
          opacity: FILL_OPACITY,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      fill.renderOrder = 3;
      this.group.add(fill);

      // Outline using actual world-space points (not the rotated geom).
      const outlinePts = poly.map(p => this.terrain.gridToWorld(p.gx, p.gy, LIFT + 0.005));
      // Close the loop
      if (outlinePts.length > 0) outlinePts.push(outlinePts[0]);
      const outlineGeom = new THREE.BufferGeometry().setFromPoints(outlinePts);
      const outline = new THREE.Line(
        outlineGeom,
        new THREE.LineBasicMaterial({
          color: OUTLINE_COLOR,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
        })
      );
      outline.renderOrder = 8;
      this.group.add(outline);
    }
  }

  toggle() {
    this.setVisible(!this._visible);
    return this._visible;
  }

  setVisible(b) {
    this._visible = !!b;
    this.group.visible = this._visible;
  }

  isVisible() { return this._visible; }
}
