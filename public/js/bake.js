// Merge static child meshes to cut draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const prep = (geo, m) => {
  let g = geo.clone().applyMatrix4(m);
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  return g;
};

// Merge each node's direct mesh children that share a material (keeps materials).
export function bakeByMaterial(root) {
  const nodes = [];
  root.traverse((o) => nodes.push(o));
  for (const node of nodes) {
    const groups = new Map();
    for (const c of node.children) if (c.isMesh && !c.isInstancedMesh && c.children.length === 0) {
      if (!groups.has(c.material)) groups.set(c.material, []);
      groups.get(c.material).push(c);
    }
    for (const [mat, list] of groups) {
      if (list.length < 2) continue;
      const geos = list.map((c) => { c.updateMatrix(); return prep(c.geometry, c.matrix); });
      const merged = new THREE.Mesh(mergeGeometries(geos, false), mat);
      merged.castShadow = list.some((c) => c.castShadow); merged.receiveShadow = true;
      for (const c of list) node.remove(c);
      node.add(merged);
    }
  }
  return root;
}

// Merge each node's mesh children into one vertex-coloured mesh (materials -> colours).
export function bakeVertexColors(root, material, tint = null) {
  const nodes = [];
  root.traverse((o) => nodes.push(o));
  const col = new THREE.Color();
  for (const node of nodes) {
    const list = node.children.filter((c) => c.isMesh && c.children.length === 0);
    if (!list.length) continue;
    const geos = list.map((c) => {
      c.updateMatrix();
      const g = prep(c.geometry, c.matrix);
      col.copy(c.material.color);
      if (c.material.transparent && tint) col.lerp(tint, 1 - c.material.opacity);
      const n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g;
    });
    const merged = new THREE.Mesh(mergeGeometries(geos, false), material);
    merged.castShadow = true; merged.receiveShadow = true;
    for (const c of list) node.remove(c);
    node.add(merged);
  }
  return root;
}
