import * as THREE from 'three';
import type { Story } from '../data';

/**
 * Analytic picking: unproject the pointer ray, intersect the unit Earth
 * sphere, convert the hit to Earth-local space (markers live in the rotating
 * mesh frame), then nearest-neighbour among visible stories within a ~16px
 * angular threshold. Trivial for ~1.3k items.
 */
export interface Picking {
  /** Visible story indices under the pointer, nearest first (empty if none). */
  pick(ndcX: number, ndcY: number): number[];
}

export function makePicking(
  camera: THREE.PerspectiveCamera,
  earthMesh: THREE.Object3D,
  stories: Story[],
  isVisible: (i: number) => boolean
): Picking {
  const inv = new THREE.Matrix4();
  const o = new THREE.Vector3();
  const d = new THREE.Vector3();
  const p = new THREE.Vector3();
  const wp = new THREE.Vector3();
  const dirs = stories.map((s) => {
    const la = (s.lat * Math.PI) / 180;
    const lo = (s.lon * Math.PI) / 180;
    const cp = Math.cos(la);
    return new THREE.Vector3(cp * Math.cos(lo), Math.sin(la), -cp * Math.sin(lo));
  });

  return {
    pick(ndcX, ndcY) {
      d.set(ndcX, ndcY, -1).unproject(camera).sub(camera.position).normalize();
      o.copy(camera.position);

      inv.copy(earthMesh.matrixWorld).invert();
      o.applyMatrix4(inv);
      d.transformDirection(inv);

      // intersect sphere at origin, radius 1
      const b = o.dot(d);
      const c = o.lengthSq() - 1;
      const disc = b * b - c;
      if (disc < 0) return [];
      const t = -b - Math.sqrt(disc);
      if (t < 0) return [];
      p.copy(o).addScaledVector(d, t);

      // angular threshold ≈ 16 px at the pick point (unit sphere ⇒ arc == angle)
      const dist = camera.position.distanceTo(earthMesh.getWorldPosition(wp)) - 1;
      const halfH = Math.tan((camera.fov * Math.PI) / 360);
      const arcPx16 = (16 * dist) / (window.innerHeight / 2 / halfH);
      const thresh = Math.min(0.6, Math.max(2.5e-3, arcPx16));
      const bestDot = Math.cos(thresh);

      const hits: { i: number; dot: number }[] = [];
      for (let i = 0; i < stories.length; i++) {
        if (!isVisible(i)) continue;
        const dot = p.dot(dirs[i]);
        if (dot > bestDot) hits.push({ i, dot });
      }
      return hits.sort((a, b) => b.dot - a.dot).map((h) => h.i);
    }
  };
}
