// TerrainMesh — converts the scenario's heightmap + fuel grid into a
// displaced PlaneGeometry with a procedurally-shaded "satellite" texture.
// Provides helpers to convert grid (gx,gy) to scene-space (x,y,z) so
// downstream renderers (roads, zones, fire) can drape onto the surface.

import * as THREE from 'three';

const TERRAIN_WORLD = 6;          // plane width = 6 scene units (~6 m tabletop)
const TERRAIN_HEIGHT = 0.75;       // peak displacement
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
      roughness: 0.85,
      metalness: 0.0,
      flatShading: false
    });

    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.name = 'terrain';

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
  // Render a satellite-style RGB image to a CanvasTexture: green at low-mid
  // elevations (chaparral / timber), tan/brown at peaks, grey for urban,
  // dark slate for rock. Adds soft hillshading from the heightmap gradient.
  const grid = scenario.gridSize;
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const heights = scenario.heightmap;
  const fuel = scenario.fuelGrid;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const ux = px / size;
      const uy = py / size;
      const h = sampleBilinear(heights, grid, ux, uy);
      // Hillshading via gradient
      const eps = 1 / size;
      const hL = sampleBilinear(heights, grid, Math.max(0, ux - eps), uy);
      const hR = sampleBilinear(heights, grid, Math.min(1, ux + eps), uy);
      const hU = sampleBilinear(heights, grid, ux, Math.max(0, uy - eps));
      const hD = sampleBilinear(heights, grid, ux, Math.min(1, uy + eps));
      const dx = hR - hL, dy = hD - hU;
      const slope = Math.hypot(dx, dy) * 80;
      const lightDirX = -0.6, lightDirY = -0.6, lightZ = 0.4;
      const nLen = Math.sqrt(dx * dx + dy * dy + 0.0001);
      const shade = Math.max(0.45, Math.min(1.0,
        0.55 + (-dx * lightDirX - dy * lightDirY) / nLen * 0.55 + lightZ * 0.2 - slope * 0.02
      ));

      const fIdx = nearestFuel(fuel, grid, ux, uy);
      let r, g, b;
      if (fIdx === 0) { r = 60; g = 60; b = 70; }                 // rock
      else if (fIdx === 1) { r = 165; g = 162; b = 88; }          // grass / dry
      else if (fIdx === 2) {                                      // chaparral
        r = 92; g = 110; b = 64;
      }
      else if (fIdx === 3) {                                      // timber
        r = 46; g = 78; b = 50;
      }
      else if (fIdx === 4) {                                      // urban
        r = 145; g = 142; b = 148;
      }
      // Elevation tint (peaks to tan, mids stay)
      if (h > 0.7) {
        const t = (h - 0.7) / 0.3;
        r = Math.round(r * (1 - t) + 168 * t);
        g = Math.round(g * (1 - t) + 142 * t);
        b = Math.round(b * (1 - t) + 100 * t);
      } else if (h < 0.18) {
        // dry creek
        r = 110; g = 100; b = 80;
      }
      const i = (py * size + px) * 4;
      img.data[i + 0] = Math.min(255, r * shade);
      img.data[i + 1] = Math.min(255, g * shade);
      img.data[i + 2] = Math.min(255, b * shade);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Add a subtle vignette and grain
  ctx.globalCompositeOperation = 'multiply';
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size * 0.7);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(150,170,190,1)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function nearestFuel(fuel, grid, ux, uy) {
  const x = Math.min(grid - 1, Math.max(0, Math.round(ux * (grid - 1))));
  const y = Math.min(grid - 1, Math.max(0, Math.round(uy * (grid - 1))));
  return fuel[y * grid + x];
}

export const TERRAIN_PARAMS = { TERRAIN_WORLD, TERRAIN_HEIGHT };
