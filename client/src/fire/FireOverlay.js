// FireOverlay — renders the CA grid as a translucent shader plane that hovers
// just above the terrain surface. A DataTexture encodes per-cell state, and
// the fragment shader animates a flickering glow over burning cells.

import * as THREE from 'three';
import { TERRAIN_PARAMS } from '../terrain/TerrainMesh.js';
import { FIRE_STATE } from './CellularAutomata.js';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uState;
  uniform float uTime;
  uniform float uFade;   // 1.0 = full, ~0.25 = evacuate-mode dimmed
  varying vec2 vUv;

  // Cheap hash-based noise for the flicker
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  void main() {
    vec2 uv = vUv;
    vec4 s = texture2D(uState, uv);
    float burning = step(0.4, s.r) * (1.0 - step(0.7, s.r));   // approx 0.5 channel
    float burned  = step(0.7, s.r);

    // Sample neighborhood to create soft halo around burning fronts
    float halo = 0.0;
    float k = 1.5 / 128.0;
    for (int yi = -1; yi <= 1; yi++) {
      for (int xi = -1; xi <= 1; xi++) {
        vec2 o = vec2(float(xi), float(yi)) * k;
        vec4 sn = texture2D(uState, uv + o);
        halo += step(0.4, sn.r) * (1.0 - step(0.7, sn.r));
      }
    }
    halo /= 9.0;

    float flicker = 0.85 + 0.4 * noise(uv * 90.0 + uTime * 4.0);

    vec3 fireColor = mix(vec3(1.0, 0.45, 0.10), vec3(1.0, 0.85, 0.25), 0.5 + 0.5 * sin(uTime * 7.0 + uv.x * 30.0));
    vec3 burntColor = vec3(0.10, 0.07, 0.05);

    vec3 col = vec3(0.0);
    float alpha = 0.0;

    if (burned > 0.5) {
      col = burntColor;
      alpha = 0.8;
    }
    if (burning > 0.5) {
      col = fireColor * flicker;
      alpha = 0.9;
    } else if (halo > 0.05) {
      col = mix(col, fireColor, halo);
      alpha = max(alpha, halo * 0.55);
    }

    alpha *= uFade;
    if (alpha < 0.015) discard;

    gl_FragColor = vec4(col, alpha);
  }
`;

export class FireOverlay {
  constructor(scenario, terrain, ca) {
    this.terrain = terrain;
    this.ca = ca;
    this.grid = scenario.gridSize;

    // Build a displaced plane that mirrors the terrain surface but slightly above.
    const seg = 95;
    const geom = new THREE.PlaneGeometry(
      TERRAIN_PARAMS.TERRAIN_WORLD,
      TERRAIN_PARAMS.TERRAIN_WORLD,
      seg, seg
    );
    geom.rotateX(-Math.PI / 2);
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const ux = (pos.getX(i) / TERRAIN_PARAMS.TERRAIN_WORLD) + 0.5;
      const uz = (pos.getZ(i) / TERRAIN_PARAMS.TERRAIN_WORLD) + 0.5;
      const h = sample(scenario.heightmap, scenario.gridSize, ux, uz);
      pos.setY(i, h * TERRAIN_PARAMS.TERRAIN_HEIGHT + 0.012);
    }
    geom.computeVertexNormals();

    // DataTexture for cell states: encode state*0.5 in red channel
    this.data = new Uint8Array(this.grid * this.grid * 4);
    this.tex = new THREE.DataTexture(
      this.data, this.grid, this.grid,
      THREE.RGBAFormat, THREE.UnsignedByteType
    );
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;

    this._targetFade = 1.0;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uState: { value: this.tex },
        uTime:  { value: 0 },
        uFade:  { value: 1.0 }
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });

    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.renderOrder = 5;
    this.mesh.name = 'fire-overlay';
  }

  setEvacMode(active) {
    this._targetFade = active ? 0.22 : 1.0;
  }

  update(dt) {
    this.material.uniforms.uTime.value += dt;
    // Smooth fade toward target
    const u = this.material.uniforms.uFade;
    u.value += (this._targetFade - u.value) * Math.min(1, dt * 4);
    const state = this.ca.state;
    const data = this.data;
    for (let i = 0; i < state.length; i++) {
      const v = state[i];
      const r = v === FIRE_STATE.STATE_BURNING ? 128
              : v === FIRE_STATE.STATE_BURNED ? 220
              : 0;
      const o = i * 4;
      data[o + 0] = r;
      data[o + 1] = 0;
      data[o + 2] = 0;
      data[o + 3] = 255;
    }
    this.tex.needsUpdate = true;
  }
}

function sample(arr, grid, ux, uz) {
  const fx = Math.max(0, Math.min(grid - 1.0001, ux * (grid - 1)));
  const fy = Math.max(0, Math.min(grid - 1.0001, uz * (grid - 1)));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = x0 + 1, y1 = y0 + 1;
  const tx = fx - x0, ty = fy - y0;
  const a = arr[y0 * grid + x0];
  const b = arr[y0 * grid + x1];
  const c = arr[y1 * grid + x0];
  const d = arr[y1 * grid + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
