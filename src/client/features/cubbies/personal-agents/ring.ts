import * as THREE from 'three';

/** Attached to the character, but grounded and unscaled even when its chair anchor is raised/scaled. */
export class OwnerRing {
  readonly mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshToonMaterial>;
  floorY = 0;
  private at = new THREE.Vector3();
  private scale = new THREE.Vector3();

  constructor(root: THREE.Object3D, diameter: number) {
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(diameter / 2 - 0.08, diameter / 2, 64),
      new THREE.MeshToonMaterial({ color: '#1e40c8', emissive: '#1e40c8', emissiveIntensity: 0.3, side: THREE.DoubleSide }));
    this.mesh.name = 'owner-ring';
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.035; // Above the office and cubby rugs (up to 0.029 m).
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.mesh.material.userData.outlineParameters = { visible: false };
    root.add(this.mesh);
  }

  setColor(color: string) { this.mesh.material.color.set(color); this.mesh.material.emissive.set(color); }

  update() {
    const root = this.mesh.parent;
    if (!root) return;
    root.updateWorldMatrix(true, false);
    root.getWorldPosition(this.at); root.getWorldScale(this.scale);
    this.mesh.position.y = (this.floorY + 0.035 - this.at.y) / this.scale.y;
    this.mesh.scale.set(1 / this.scale.x, 1 / this.scale.z, 1);
  }

  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
