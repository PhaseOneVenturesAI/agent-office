// Optional interior fixtures share the office's sky-driven lamp level and draft fade.
// Materials are owned by each fixture, so dimming never changes a cached toon material.
import * as THREE from 'three';
import type { Fixture } from './fixture';

export interface InteriorLamp {
  active(): boolean;
  lights: { light: THREE.PointLight; power: number }[];
  bulbs: { mat: THREE.MeshToonMaterial; day: number }[];
  /** A stretch that should read as night once the lamps are on: the room's fill goes down to `level` there (see fillAt). */
  nightFill?: { at(x: number, z: number): boolean; level: number };
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
  /** How much of the room's fill light to keep standing at (x, z): 1 by day and outside any lamp's night stretch. */
  fillAt(x: number, z: number, night: number): number {
    let keep = 1;
    for (const lamp of this.lamps) {
      if (lamp.nightFill && lamp.active() && lamp.nightFill.at(x, z)) keep = Math.min(keep, THREE.MathUtils.lerp(1, lamp.nightFill.level, night));
    }
    return keep;
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
