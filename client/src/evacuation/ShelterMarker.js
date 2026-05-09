// ShelterMarker — green diamond markers above each shelter, vertical
// capacity bar, stalk to terrain. In COMMAND mode the marshal can click
// a diamond to compromise/restore the shelter (toggle availability for
// routing). Compromised shelters stay drawn but greyed + ringed in red,
// per UX instruction (NEVER deleted).
//
// Diamond meshes are added to a dedicated `pickGroup` so the click
// raycaster can intersect them without picking up bars / stalks.

import * as THREE from 'three';

const COLOR_OK         = 0x5eea8d;
const COLOR_BARFILL_OK = 0x5eea8d;
const COLOR_BARFILL_HI = 0xf5d76e;
const COLOR_BARFILL_FULL = 0xff6655;
const COLOR_COMPROMISED = 0x707070;
const COLOR_COMPROMISED_RING = 0xff3030;

function makeLabelSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(40,8,8,0.85)';
  ctx.beginPath();
  ctx.roundRect(2, 4, canvas.width - 4, canvas.height - 8, 10);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = 'bold 24px monospace';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 12;
  return sprite;
}

export class ShelterMarker {
  constructor(scenario, terrain) {
    this.scenario = scenario;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'shelters';
    this.pickGroup = new THREE.Group();   // diamonds-only for click picking
    this.pickGroup.name = 'shelters-pick';
    this.group.add(this.pickGroup);
    this.markers = [];
    this._evacMode = false;
    this._build();
  }

  setEvacMode(active) {
    this._evacMode = active;
    for (const m of this.markers) {
      m.diamond.material.emissiveIntensity = active ? 1.4 : 0.6;
      m.diamond.scale.setScalar(active ? 1.45 : 1.0);
    }
  }

  _build() {
    for (const s of this.scenario.shelters) {
      this._addShelterMesh(s);
    }
  }

  _addShelterMesh(s) {
    const node = this.scenario.nodes[s.nodeId];
    if (!node) return;
    const pos = this.terrain.gridToWorld(node.x, node.z, 0.16);

    // Diamond — pickable. Larger pickable target than just the geometry
    // (enlarged invisible hitbox sphere) so clicks land reliably.
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.07, 0),
      new THREE.MeshStandardMaterial({
        color: COLOR_OK, emissive: 0x113322, emissiveIntensity: 0.6,
        metalness: 0.4, roughness: 0.3
      })
    );
    diamond.position.copy(pos);
    diamond.userData.shelterNodeId = s.nodeId;
    this.pickGroup.add(diamond);

    // Capacity bar background
    const barBg = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.18, 0.012),
      new THREE.MeshBasicMaterial({ color: 0x183020, transparent: true, opacity: 0.6 })
    );
    barBg.position.copy(pos).add(new THREE.Vector3(0.07, 0, 0));
    this.group.add(barBg);

    // Capacity bar fill
    const barFill = new THREE.Mesh(
      new THREE.BoxGeometry(0.014, 0.17, 0.014),
      new THREE.MeshBasicMaterial({ color: COLOR_BARFILL_OK })
    );
    barFill.position.copy(barBg.position).setY(barBg.position.y - 0.085);
    barFill.scale.y = 0.02;
    this.group.add(barFill);

    // Stalk
    const surface = this.terrain.gridToWorld(node.x, node.z, 0.005);
    const stalkGeom = new THREE.BufferGeometry().setFromPoints([surface, pos]);
    const stalk = new THREE.Line(stalkGeom, new THREE.LineBasicMaterial({
      color: COLOR_OK, transparent: true, opacity: 0.5
    }));
    this.group.add(stalk);

    // Compromised cross — two crossed bars at the shelter (bigger and more
    // obvious than the previous thin ring). Starts hidden; setVisible flips
    // it on _applyCompromisedState.
    const xGroup = new THREE.Group();
    const xMat = new THREE.MeshBasicMaterial({
      color: COLOR_COMPROMISED_RING, transparent: true, opacity: 0, depthWrite: false,
    });
    const barGeom = new THREE.BoxGeometry(0.22, 0.018, 0.04);
    const bar1 = new THREE.Mesh(barGeom, xMat);
    bar1.rotation.y = Math.PI / 4;
    const bar2 = new THREE.Mesh(barGeom, xMat);
    bar2.rotation.y = -Math.PI / 4;
    xGroup.add(bar1, bar2);
    xGroup.position.copy(pos);
    xGroup.position.y += 0.04;
    this.group.add(xGroup);

    // Floating "COMPROMISED" canvas-texture label, billboarded toward
    // camera in update(). Initially hidden.
    const label = makeLabelSprite('COMPROMISED', '#ff5f5f');
    label.position.copy(pos);
    label.position.y += 0.32;
    label.scale.set(0.55, 0.13, 1);
    label.material.opacity = 0;
    this.group.add(label);

    const rec = { shelter: s, diamond, barFill, barBg, stalk, xGroup, xMat, label };
    this.markers.push(rec);
    this._applyCompromisedState(rec, !!s.compromised);
  }

  _applyCompromisedState(rec, compromised) {
    if (compromised) {
      rec.diamond.material.color.setHex(COLOR_COMPROMISED);
      rec.diamond.material.emissive.setHex(0x300000);
      rec.diamond.material.emissiveIntensity = 0.4;
      rec.diamond.material.opacity = 0.55;
      rec.diamond.material.transparent = true;
      rec.barFill.material.opacity = 0.2;
      rec.stalk.material.color.setHex(COLOR_COMPROMISED);
      if (rec.xGroup) rec.xMat.opacity = 0.95;
      if (rec.label) rec.label.material.opacity = 1;
    } else {
      rec.diamond.material.color.setHex(COLOR_OK);
      rec.diamond.material.emissive.setHex(0x113322);
      rec.diamond.material.emissiveIntensity = 0.6;
      rec.diamond.material.opacity = 1;
      rec.diamond.material.transparent = false;
      rec.barFill.material.opacity = 1;
      rec.stalk.material.color.setHex(COLOR_OK);
      if (rec.xGroup) rec.xMat.opacity = 0;
      if (rec.label) rec.label.material.opacity = 0;
    }
  }

  // Sync the renderer's view of the shelter list against the latest
  // scenario.shelters data. Picks up: new shelters added by the user,
  // compromised flag changes. Per UX rule, never removes a marker.
  syncShelters(shelters) {
    if (!Array.isArray(shelters)) return;
    const knownIds = new Set(this.markers.map(m => m.shelter.nodeId));
    // Add any new shelters that don't yet have a marker.
    for (const s of shelters) {
      if (!knownIds.has(s.nodeId)) {
        this._addShelterMesh(s);
      } else {
        // Same nodeId — update the inner reference + state.
        const rec = this.markers.find(m => m.shelter.nodeId === s.nodeId);
        if (rec) {
          rec.shelter = s;
          this._applyCompromisedState(rec, !!s.compromised);
        }
      }
    }
  }

  setUsage(usage) {
    for (const m of this.markers) {
      const u = usage.find(x => x.nodeId === m.shelter.nodeId);
      if (!u) continue;
      // If a usage report says compromised, sync the visual.
      if (typeof u.compromised === 'boolean' && u.compromised !== !!m.shelter.compromised) {
        m.shelter = { ...m.shelter, compromised: u.compromised };
        this._applyCompromisedState(m, u.compromised);
      }
      const ratio = Math.max(0, Math.min(1, u.used / u.capacity));
      m.barFill.scale.y = Math.max(0.02, ratio);
      m.barFill.position.y = m.barBg.position.y - 0.085 + (m.barFill.scale.y * 0.085);
      m.barFill.material.color.setHex(
        m.shelter.compromised ? COLOR_COMPROMISED
        : ratio > 0.85 ? COLOR_BARFILL_FULL
        : ratio > 0.6  ? COLOR_BARFILL_HI
        : COLOR_BARFILL_OK
      );
    }
  }

  // Raycast against shelter diamonds. Returns the shelter nodeId if
  // hit, else null. Used by main.js click router in COMMAND mode.
  pickShelter(camera, ndcX, ndcY) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: ndcX, y: ndcY }, camera);
    const hits = ray.intersectObjects(this.pickGroup.children, false);
    if (!hits.length) return null;
    return hits[0].object.userData.shelterNodeId ?? null;
  }
}
