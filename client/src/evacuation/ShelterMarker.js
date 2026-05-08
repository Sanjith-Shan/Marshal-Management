// ShelterMarker — green diamond markers above each shelter, with a vertical
// fill bar showing capacity utilization.

import * as THREE from 'three';

export class ShelterMarker {
  constructor(scenario, terrain) {
    this.scenario = scenario;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'shelters';
    this.markers = [];
    this._build();
  }

  _build() {
    for (const s of this.scenario.shelters) {
      const node = this.scenario.nodes[s.nodeId];
      const pos = this.terrain.gridToWorld(node.x, node.z, 0.16);

      // Diamond
      const diamond = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.06, 0),
        new THREE.MeshStandardMaterial({
          color: 0x5eea8d, emissive: 0x113322, emissiveIntensity: 0.6,
          metalness: 0.4, roughness: 0.3
        })
      );
      diamond.position.copy(pos);
      this.group.add(diamond);

      // Capacity bar
      const barBg = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.18, 0.012),
        new THREE.MeshBasicMaterial({ color: 0x183020, transparent: true, opacity: 0.6 })
      );
      barBg.position.copy(pos).add(new THREE.Vector3(0.07, 0, 0));
      this.group.add(barBg);
      const barFill = new THREE.Mesh(
        new THREE.BoxGeometry(0.014, 0.17, 0.014),
        new THREE.MeshBasicMaterial({ color: 0x5eea8d })
      );
      barFill.position.copy(barBg.position).setY(barBg.position.y - 0.085);
      barFill.scale.y = 0.02;
      this.group.add(barFill);

      // Stalk to terrain
      const surface = this.terrain.gridToWorld(node.x, node.z, 0.005);
      const stalkGeom = new THREE.BufferGeometry().setFromPoints([surface, pos]);
      const stalk = new THREE.Line(stalkGeom, new THREE.LineBasicMaterial({
        color: 0x5eea8d, transparent: true, opacity: 0.5
      }));
      this.group.add(stalk);

      this.markers.push({ shelter: s, diamond, barFill, barBg });
    }
  }

  setUsage(usage) {
    // usage: [{ nodeId, used, capacity }]
    for (const m of this.markers) {
      const u = usage.find(x => x.nodeId === m.shelter.nodeId);
      if (!u) continue;
      const ratio = Math.max(0, Math.min(1, u.used / u.capacity));
      m.barFill.scale.y = Math.max(0.02, ratio);
      m.barFill.position.y = m.barBg.position.y - 0.085 + (m.barFill.scale.y * 0.085);
      m.barFill.material.color.setHex(
        ratio > 0.85 ? 0xff6655 : ratio > 0.6 ? 0xf5d76e : 0x5eea8d
      );
    }
  }
}
