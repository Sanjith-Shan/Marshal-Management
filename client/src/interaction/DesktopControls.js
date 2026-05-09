// DesktopControls — mouse drag rotates the terrain group, wheel/Q-Z zooms,
// WASD pans the camera target. Designed to feel like manipulating a tabletop
// model. Disabled when an AR session is active (XR drives the camera).

import * as THREE from 'three';

export class DesktopControls {
  constructor(camera, canvas, terrainGroup) {
    this.camera = camera;
    this.canvas = canvas;
    this.target = terrainGroup;
    this.distance = 22;            // initial camera distance (bigger bbox + bigger TERRAIN_WORLD)
    this.MIN_DIST = 2.0;
    this.MAX_DIST = 90;
    this.azimuth = 0.6;            // rad
    this.elevation = 0.65;         // rad above horizon
    // Default focal point: populated cluster centroid in the expanded
    // bbox (Mira Mesa / Scripps Ranch / Poway / Qualcomm corridor).
    // Slight west bias so the SD coast is in view; east mountains are
    // visible but off-center. The fire ignites east of Ramona — visible
    // as fire arrives in the inhabited belt.
    this.center = new THREE.Vector3(-1.5, 0, 0.0);
    this.dragging = false;
    this.last = { x: 0, y: 0 };
    this._dragPixels = 0;
    this.keys = new Set();
    this.enabled = true;

    canvas.addEventListener('mousedown', (e) => this._onDown(e));
    window.addEventListener('mouseup', (e) => this._onUp(e));
    window.addEventListener('mousemove', (e) => this._onMove(e));
    canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    this._apply();
  }

  setEnabled(b) { this.enabled = b; }

  // True if the last mousedown was followed by significant pointer movement
  // before mouseup. Used by the canvas click handler to suppress accidental
  // road-block triggers after a camera rotation gesture.
  get hasDragged() { return this._dragPixels > 5; }

  _onDown(e) {
    if (!this.enabled) return;
    if (e.button !== 0) return;
    if (e.target !== this.canvas) return;
    this.dragging = true;
    this._dragPixels = 0;
    this.last.x = e.clientX;
    this.last.y = e.clientY;
  }

  _onUp() { this.dragging = false; }

  _onMove(e) {
    if (!this.dragging) return;
    const dx = e.clientX - this.last.x;
    const dy = e.clientY - this.last.y;
    this._dragPixels += Math.hypot(dx, dy);
    this.last.x = e.clientX;
    this.last.y = e.clientY;
    this.azimuth -= dx * 0.005;
    this.elevation -= dy * 0.005;
    this.elevation = Math.max(0.18, Math.min(1.45, this.elevation));
  }

  _onWheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this.distance *= (1 + e.deltaY * 0.0014);
    this.distance = Math.max(this.MIN_DIST, Math.min(this.MAX_DIST, this.distance));
  }

  pulseRotate(dx, dy) {
    // Called by hardware joystick events
    this.azimuth -= dx * 0.04;
    this.elevation = Math.max(0.18, Math.min(1.45, this.elevation - dy * 0.03));
  }

  resetView() {
    this.distance = 22;
    this.azimuth = 0.6;
    this.elevation = 0.65;
    this.center.set(-1.5, 0, 0.0);
  }

  update(dt) {
    if (!this.enabled) return;
    const speed = 4 * dt;
    const right = new THREE.Vector3(Math.cos(this.azimuth), 0, -Math.sin(this.azimuth));
    const fwd = new THREE.Vector3(-Math.sin(this.azimuth), 0, -Math.cos(this.azimuth));
    if (this.keys.has('KeyW')) this.center.addScaledVector(fwd, speed);
    if (this.keys.has('KeyS')) this.center.addScaledVector(fwd, -speed);
    if (this.keys.has('KeyA')) this.center.addScaledVector(right, -speed);
    if (this.keys.has('KeyD')) this.center.addScaledVector(right, speed);
    if (this.keys.has('KeyQ')) this.distance = Math.max(this.MIN_DIST, this.distance - speed * 2.4);
    if (this.keys.has('KeyZ')) this.distance = Math.min(this.MAX_DIST, this.distance + speed * 2.4);
    if (this.keys.has('ArrowLeft')) this.azimuth += dt * 0.9;
    if (this.keys.has('ArrowRight')) this.azimuth -= dt * 0.9;
    if (this.keys.has('ArrowUp')) this.elevation = Math.min(1.45, this.elevation + dt * 0.6);
    if (this.keys.has('ArrowDown')) this.elevation = Math.max(0.18, this.elevation - dt * 0.6);

    this._apply();
  }

  _apply() {
    const x = this.distance * Math.cos(this.elevation) * Math.sin(this.azimuth);
    const z = this.distance * Math.cos(this.elevation) * Math.cos(this.azimuth);
    const y = this.distance * Math.sin(this.elevation);
    this.camera.position.set(this.center.x + x, this.center.y + y, this.center.z + z);
    this.camera.lookAt(this.center);
  }
}
