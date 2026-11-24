import * as THREE from 'three';

/** Keep visible occluders, but never run triangle tests on hidden scene branches. No scene cache. */
export function visibleIntersections(ray: THREE.Raycaster, roots: readonly THREE.Object3D[], far = Infinity): THREE.Intersection[] {
  const previous = ray.far;
  const hits: THREE.Intersection[] = [];
  const visit = (object: THREE.Object3D) => {
    if (!object.visible) return;
    // Like Raycaster, a custom raycast may stop recursion; a layer mismatch does not.
    if (object.layers.test(ray.layers) && (object.raycast(ray, hits) as boolean | undefined) === false) return;
    for (const child of object.children) visit(child);
  };
  try {
    ray.far = Math.min(previous, far);
    for (const root of roots) {
      let shown = true;
      for (let parent = root.parent; parent; parent = parent.parent) if (!parent.visible) { shown = false; break; }
      if (shown) visit(root);
    }
    return hits.sort((a, b) => a.distance - b.distance);
  } finally {
    ray.far = previous;
  }
}
