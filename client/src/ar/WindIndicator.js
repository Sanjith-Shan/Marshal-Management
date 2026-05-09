// WindIndicator — 3D arrow on the corner of the terrain showing where the
// wind is blowing TOWARD (meteorological windDeg is the FROM direction;
// we show the +180° toward-vector). Length scales with wind speed; arrow
// pulses faster in Red Flag conditions.
//
// Convention matches CellularAutomata's wind math:
//   toward-radians = (windDeg + 180) * π / 180
//   wx = sin(rad), wy = -cos(rad)   in cell-space
//   In our 3D scene, +X is East, +Z is South. Cell wy maps to world Z.
//   So the world-space wind toward-vector is (wx, 0, wy).

import * as THREE from 'three';
import { TERRAIN_PARAMS } from '../terrain/TerrainMesh.js';

const HALF = TERRAIN_PARAMS.TERRAIN_WORLD / 2;

export class WindIndicator {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'wind-indicator';
    this._windDeg = 0;
    this._windKph = 0;
    this._redFlag = false;
    this._build();
  }

  _build() {
    // Origin at NE corner, lifted above terrain so it's visible from low angles.
    this.origin = new THREE.Vector3(HALF * 0.85, TERRAIN_PARAMS.TERRAIN_HEIGHT + 0.55, -HALF * 0.85);

    this.arrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),       // initial direction; updated in setWind
      this.origin.clone(),
      0.7,                              // initial length
      0xffd166,                         // amber
      0.18,                             // head length
      0.12                              // head width
    );
    this.arrow.line.material.linewidth = 3;
    this.arrow.cone.material.transparent = true;
    this.arrow.line.material.transparent = true;
    this.group.add(this.arrow);

    // Floating label "WIND" + speed
    this.labelMesh = makeLabelSprite('WIND', '#ffd166');
    this.labelMesh.position.copy(this.origin).add(new THREE.Vector3(0, 0.30, 0));
    this.labelMesh.scale.set(0.4, 0.13, 1);
    this.group.add(this.labelMesh);
  }

  setWind(deg, kph, redFlag = false) {
    this._windDeg = deg;
    this._windKph = kph;
    this._redFlag = !!redFlag;

    // Toward-direction unit vector in scene space (+X east, +Z south)
    const toward = (deg + 180) * Math.PI / 180;
    const wx = Math.sin(toward);
    const wz = -Math.cos(toward);
    const dir = new THREE.Vector3(wx, 0, wz).normalize();
    this.arrow.setDirection(dir);

    // Length scales with wind speed (clamp 0.4 .. 1.4)
    const length = Math.max(0.4, Math.min(1.4, 0.4 + kph / 50));
    this.arrow.setLength(length, length * 0.28, length * 0.18);

    // Color: amber default, red on Red Flag
    const color = redFlag ? 0xff5f5f : 0xffd166;
    this.arrow.line.material.color.setHex(color);
    this.arrow.cone.material.color.setHex(color);

    // Update label
    if (this.labelMesh) {
      this.group.remove(this.labelMesh);
      this.labelMesh.material.map?.dispose();
      this.labelMesh.material.dispose();
      this.labelMesh = makeLabelSprite(
        `WIND ${Math.round(kph)} kph${redFlag ? ' · 🚩' : ''}`,
        redFlag ? '#ff5f5f' : '#ffd166'
      );
      this.labelMesh.position.copy(this.origin).add(new THREE.Vector3(0, 0.30, 0));
      this.labelMesh.scale.set(0.55, 0.13, 1);
      this.group.add(this.labelMesh);
    }
  }

  update(dt) {
    // Subtle pulse on cone opacity, faster on Red Flag.
    const period = this._redFlag ? 350 : 700;
    const pulse = 0.7 + 0.3 * Math.abs(Math.sin(performance.now() / period));
    this.arrow.cone.material.opacity = pulse;
    this.arrow.line.material.opacity = pulse;
  }
}

function makeLabelSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(10, 14, 22, 0.78)';
  ctx.beginPath();
  ctx.roundRect(2, 8, canvas.width - 4, canvas.height - 16, 12);
  ctx.fill();
  ctx.font = 'bold 24px monospace';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 21;
  return sprite;
}
