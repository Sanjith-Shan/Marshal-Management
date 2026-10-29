// TerrainMesh — converts the scenario's heightmap + fuel grid into a
// displaced PlaneGeometry with a procedurally-shaded "satellite" texture.
// Provides helpers to convert grid (gx,gy) to scene-space (x,y,z) so
// downstream renderers (roads, zones, fire) can drape onto the surface.

import * as THREE from 'three';

const TERRAIN_WORLD = 12;         // plane width in scene units; bbox shrunk slightly + east trimmed
const TERRAIN_HEIGHT = 1.3;       // peak displacement (scaled with TERRAIN_WORLD)
const SEG = 159;                  // heightmap is 128, geometry segments slightly more for smooth edges

export class TerrainMesh {
  constructor(scenario) {
    this.scenario = scenario;
    this.size = TERRAIN_WORLD;
    this.amplitude = TERRAIN_HEIGHT;
    this.grid = scenario.gridSize;

    const geom = new THREE.PlaneGeometry(TERRAIN_WORLD, TERRAIN_WORLD, SEG, SEG);
    geom.rotateX(-Math.PI / 2);

    const pos = geom.attributes.position;
    const heights = scenario.heightmap;     // length grid*grid
    for (let i = 0; i < pos.count; i++) {
      const ux = (pos.getX(i) / TERRAIN_WORLD) + 0.5;
      const uz = (pos.getZ(i) / TERRAIN_WORLD) + 0.5;
      const h = sampleBilinear(heights, this.grid, ux, uz);
      pos.setY(i, h * TERRAIN_HEIGHT);
    }
    geom.computeVertexNormals();

    const tex = buildTerrainTexture(scenario);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.95,
      metalness: 0.0,
      flatShading: false
    });

    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.name = 'terrain';
    this.mesh.add(buildSkirt(geom, 0.35));

    this._heights = heights;
  }

  // Convert (gx, gy) cell coordinates to scene-space position on the surface.
  gridToWorld(gx, gy, hOffset = 0) {
    const ux = gx / this.grid;
    const uz = gy / this.grid;
    const x = (ux - 0.5) * TERRAIN_WORLD;
    const z = (uz - 0.5) * TERRAIN_WORLD;
    const h = sampleBilinear(this._heights, this.grid, ux, uz);
    const y = h * TERRAIN_HEIGHT + hOffset;
    return new THREE.Vector3(x, y, z);
  }

  // Inverse of gridToWorld: take a local-space (x, z) point on the terrain
  // mesh and return its grid (gx, gy). Used to convert a click on the
  // terrain into a position the scenario / engine can reason about.
  worldToGrid(x, z) {
    const ux = (x / this.size) + 0.5;
    const uz = (z / this.size) + 0.5;
    const gx = Math.max(0, Math.min(this.grid - 1, ux * this.grid));
    const gy = Math.max(0, Math.min(this.grid - 1, uz * this.grid));
    return { gx, gy };
  }

  worldHeightAt(x, z) {
    const ux = x / TERRAIN_WORLD + 0.5;
    const uz = z / TERRAIN_WORLD + 0.5;
    return sampleBilinear(this._heights, this.grid, ux, uz) * TERRAIN_HEIGHT;
  }
}

function sampleBilinear(arr, grid, ux, uz) {
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

function buildTerrainTexture(scenario) {
  // Render a muted, map-style RGB image to a CanvasTexture. Fuel colors are
  // blended bilinearly between cells (no blocky grid), lit with a soft
  // northwest hillshade, broken up with low-amplitude noise, and overlaid with
  // faint elevation contours so the relief reads at a glance.
  const grid = scenario.gridSize;
  const size = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const heights = scenario.heightmap;
  const fuel = scenario.fuelGrid;

  const PALETTE = [
    [74, 76, 80],     // rock
    [146, 136, 98],   // grass / dry
    [100, 108, 78],   // chaparral
    [62, 82, 62],     // timber
    [112, 116, 124],  // urban
  ];
  // Per-cell base color, then bilinear-sampled per pixel.
  const cellR = new Float32Array(grid * grid);
  const cellG = new Float32Array(grid * grid);
  const cellB = new Float32Array(grid * grid);
  for (let i = 0; i < grid * grid; i++) {
    const c = PALETTE[fuel[i]] || PALETTE[2];
    cellR[i] = c[0]; cellG[i] = c[1]; cellB[i] = c[2];
  }

  const hStep = 1 / grid;            // normal sampled one cell apart: smooth light
  const lx = -0.55, ly = -0.55, lz = 0.63;
  const CONTOUR = 0.045;
  const px1 = 1 / size;

  for (let py = 0; py < size; py++) {
    const uy = py / size;
    for (let px = 0; px < size; px++) {
      const ux = px / size;
      const h = sampleBilinear(heights, grid, ux, uy);

      const dx = sampleBilinear(heights, grid, Math.min(1, ux + hStep), uy) - sampleBilinear(heights, grid, Math.max(0, ux - hStep), uy);
      const dy = sampleBilinear(heights, grid, ux, Math.min(1, uy + hStep)) - sampleBilinear(heights, grid, ux, Math.max(0, uy - hStep));
      const nx = -dx * 9, ny = -dy * 9, nz = 1;
      const nl = Math.hypot(nx, ny, nz);
      const lambert = Math.max(0, (nx * lx + ny * ly + nz * lz) / nl);
      const shade = 0.42 + 0.78 * lambert;

      let r = sampleBilinear(cellR, grid, ux, uy);
      let g = sampleBilinear(cellG, grid, ux, uy);
      let b = sampleBilinear(cellB, grid, ux, uy);

      // Peaks fade toward pale stone.
      const t = Math.max(0, Math.min(1, (h - 0.62) / 0.38));
      r += (160 - r) * t * 0.7; g += (150 - g) * t * 0.7; b += (128 - b) * t * 0.7;

      const n = 0.92 + 0.08 * fbm(ux * 48, uy * 48) + 0.05 * (fbm(ux * 260, uy * 260) - 0.5);
      let k = shade * n * 0.86;

      // Contours: draw where the contour band changes between neighbors.
      const band = Math.floor(h / CONTOUR);
      const hr = sampleBilinear(heights, grid, Math.min(1, ux + px1), uy);
      const hd = sampleBilinear(heights, grid, ux, Math.min(1, uy + px1));
      let line = 0;
      if (Math.floor(hr / CONTOUR) !== band || Math.floor(hd / CONTOUR) !== band) {
        line = (band % 5 === 4) ? 0.22 : 0.10;
      }

      const i = (py * size + px) * 4;
      img.data[i + 0] = Math.min(255, r * k + (235 - r * k) * line);
      img.data[i + 1] = Math.min(255, g * k + (240 - g * k) * line);
      img.data[i + 2] = Math.min(255, b * k + (245 - b * k) * line);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Soft edge falloff so the model reads as a lit tabletop, not a cutout.
  ctx.globalCompositeOperation = 'multiply';
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.25, size / 2, size / 2, size * 0.75);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(170,180,195,1)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 16;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y) {
  return 0.55 * vnoise(x, y) + 0.3 * vnoise(x * 2.1, y * 2.1) + 0.15 * vnoise(x * 4.3, y * 4.3);
}

// Dark side walls so the terrain reads as a solid relief model.
function buildSkirt(geom, depth) {
  const pos = geom.attributes.position;
  const n = SEG + 1;
  const verts = [];
  const edges = [
    (k) => k,                         // north row
    (k) => (n - 1) * n + k,           // south row
    (k) => k * n,                     // west column
    (k) => k * n + (n - 1),           // east column
  ];
  for (const at of edges) {
    for (let k = 0; k < n - 1; k++) {
      const a = at(k), b = at(k + 1);
      const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
      const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
      verts.push(ax, ay, az, bx, by, bz, ax, -depth, az);
      verts.push(bx, by, bz, bx, -depth, bz, ax, -depth, az);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x161c25, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  const m = new THREE.Mesh(g, mat);
  m.name = 'terrain-skirt';
  return m;
}

function nearestFuel(fuel, grid, ux, uy) {
  const x = Math.min(grid - 1, Math.max(0, Math.round(ux * (grid - 1))));
  const y = Math.min(grid - 1, Math.max(0, Math.round(uy * (grid - 1))));
  return fuel[y * grid + x];
}

export const TERRAIN_PARAMS = { TERRAIN_WORLD, TERRAIN_HEIGHT };
