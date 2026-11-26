// Optional interior fixtures share the office's sky-driven lamp level and draft fade.
// Materials are owned by each fixture, so dimming never changes a cached toon material.
import * as THREE from 'three';
import type { Fixture } from './fixture';

export interface InteriorLamp {
  active(): boolean;
  lights: { light: THREE.PointLight; power: number }[];
  bulbs: { mat: THREE.MeshToonMaterial; day: number }[];
}

export class InteriorLights {
  private lamps = new Set<InteriorLamp>();
  add(lamp: InteriorLamp): () => void {
    this.lamps.add(lamp);
    return () => this.lamps.delete(lamp);
  }
  update(night: number) {
    for (const lamp of this.lamps) {
      const on = lamp.active();
      for (const { light, power } of lamp.lights) {
        light.visible = on;
        light.intensity = on ? power * night : 0;
      }
      // Same daylight-to-night interpolation as Sky's NightParts bulbs.
      for (const { mat, day } of lamp.bulbs) mat.emissiveIntensity = on ? THREE.MathUtils.lerp(day, 1, night) : 0;
    }
  }
  dim(level: number) {
    for (const lamp of this.lamps) {
      for (const { light } of lamp.lights) light.intensity *= level;
      for (const { mat } of lamp.bulbs) mat.emissiveIntensity *= level;
    }
  }
}

/** Give a pendant its own dimmable bulbs, leaving the office's shared material intact. */
export function ownBulbs(root: THREE.Object3D): InteriorLamp['bulbs'] {
  const bulbs: InteriorLamp['bulbs'] = [];
  root.traverse(o => {
    const mesh = o as THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>;
    if (!mesh.isMesh || Array.isArray(mesh.material) || !mesh.material.emissive?.getHex()) return;
    mesh.material = mesh.material.clone();
    mesh.userData.interiorBulb = true;
    bulbs.push({ mat: mesh.material, day: 0.35 });
  });
  return bulbs;
}

declare module '../types' { interface OfficeHandles { interiorLights: InteriorLights } }
export const interiorLights: Fixture<'interiorLights'> = () => ({ handle: { interiorLights: new InteriorLights() } });
