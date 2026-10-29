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
    // R = burning, G = burned; linear filtering turns the cell grid into
    // smooth fields, smoothstep turns those into clean soft-edged shapes.
    // Average the front over a one-cell disc first so the sparse cellular
    // front reads as a continuous line instead of speckle.
    float k1 = 1.0 / 128.0;
    float fr = s.r * 0.28;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7854;
      fr += texture2D(uState, uv + vec2(cos(a), sin(a)) * k1).r * 0.09;
    }
    float front  = smoothstep(0.24, 0.62, fr);
    float core   = smoothstep(0.55, 0.95, fr);
    float burned = smoothstep(0.30, 0.70, s.g);

    // Wide soft glow around the active front.
    float glow = 0.0;
    float k = 2.4 / 128.0;
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 0.5236;
      glow += texture2D(uState, uv + vec2(cos(a), sin(a)) * k).r;
      glow += texture2D(uState, uv + vec2(cos(a + 0.26), sin(a + 0.26)) * k * 2.0).r * 0.6;
    }
    glow = clamp(glow / 10.0, 0.0, 1.0);

    float n = noise(uv * 70.0 + vec2(uTime * 0.35, -uTime * 0.25));
    float flicker = 0.92 + 0.14 * n;
    vec3 ember = vec3(0.95, 0.24, 0.06);
    vec3 warm  = vec3(1.0, 0.48, 0.12);
    vec3 hot   = vec3(1.0, 0.76, 0.38);
    vec3 fireColor = mix(warm, hot, core) * flicker;
    vec3 burntColor = vec3(0.07, 0.058, 0.052) * (0.9 + 0.2 * noise(uv * 220.0));

    vec3 col = burntColor;
    float alpha = burned * 0.84;

    float haloA = glow * (1.0 - front) * 0.42;
    col = mix(col, ember, clamp(haloA / max(alpha + haloA, 0.001), 0.0, 1.0));
    alpha = max(alpha, haloA);

    col = mix(col, fireColor, front);
    alpha = max(alpha, front * 0.96);

    alpha *= uFade;
    if (alpha < 0.01) discard;
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
      blending: THREE.NormalBlending
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
      const o = i * 4;
      data[o + 0] = v === FIRE_STATE.STATE_BURNING ? 255 : 0;
      data[o + 1] = v === FIRE_STATE.STATE_BURNED ? 255 : 0;
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
