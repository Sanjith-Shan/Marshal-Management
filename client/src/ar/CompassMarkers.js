// CompassMarkers — 3D world-space N/S/E/W sprites pinned to the four
// edges of the terrain. Sprites always face the camera so the letters
// stay readable from any angle, but their positions are world-fixed —
// "N" stays at the north edge regardless of how the user rotates the view.
//
// Coordinate convention (mirrors latLngToGrid in ScenarioBuilder):
//   North = -Z   (low gy → low z)
//   South = +Z
//   East  = +X
//   West  = -X

import * as THREE from 'three';
import { TERRAIN_PARAMS } from '../terrain/TerrainMesh.js';

const HALF = TERRAIN_PARAMS.TERRAIN_WORLD / 2;       // ~3 scene units from center
const HEIGHT = TERRAIN_PARAMS.TERRAIN_HEIGHT + 0.4;  // float above terrain peak
const SPRITE_SIZE = 0.55;

export class CompassMarkers {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'compass';
    this._build();
  }

  _build() {
    const positions = [
      { label: 'N', pos: [0,    HEIGHT, -HALF], color: '#ff5f5f' },
      { label: 'S', pos: [0,    HEIGHT,  HALF], color: '#cfe6ff' },
      { label: 'E', pos: [ HALF, HEIGHT, 0   ], color: '#cfe6ff' },
      { label: 'W', pos: [-HALF, HEIGHT, 0   ], color: '#cfe6ff' },
    ];
    for (const m of positions) {
      const sprite = makeLetterSprite(m.label, m.color);
      sprite.position.set(m.pos[0], m.pos[1], m.pos[2]);
      sprite.scale.set(SPRITE_SIZE, SPRITE_SIZE, 1);
      this.group.add(sprite);
    }
  }
}

function makeLetterSprite(letter, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  // Backing dot for legibility
  ctx.fillStyle = 'rgba(10, 14, 22, 0.72)';
  ctx.beginPath();
  ctx.arc(64, 64, 56, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.font = 'bold 80px monospace';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 64, 70);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 20;
  return sprite;
}
