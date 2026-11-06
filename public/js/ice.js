// Frozen lakes: the ice slab is meshed from the same cells the collision uses (shared/ice.js), finely
// around you (ragged broken edges, holes, a visible thickness) and coarsely out to the horizon. Broken
// holes get bobbing shards of floating ice until they freeze over.
import * as THREE from 'three';
import { ICE_TOP, ICE_BOT, ICE_CELL } from '/shared/ice.js';
import { hash3 } from '/shared/noise.js';

const NEAR = 36, NEAR_R = 2;             // fine chunks (0.75 m cells) in a 5x5 window around you
const FAR = 144, FAR_CELL = 3, FAR_R = 4; // coarse chunks out to ~650 m
const nk = (i, j) => i + ',' + j;
const ij = (k) => k.split(',').map(Number);

export class IceView {
  constructor(scene, field, world) {
    this.scene = scene; this.field = field; this.world = world;
    this.near = new Map(); this.far = new Map();
    this.rev = -1; this.win = null; this.queue = [];
    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 140, specular: 0x8fa9bd, side: THREE.FrontSide });
    this.light = { value: 1 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uIceLight = this.light;
      sh.vertexShader = 'varying vec3 vIW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvIW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'varying vec3 vIW;\nuniform float uIceLight;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // seen from below, daylight glows through the slab (brighter where it's thin and cracked)
        if (vIW.y < ${(ICE_BOT + 0.03).toFixed(2)}) {
          float cr = abs(sin(vIW.x * 0.9 + sin(vIW.z * 0.55) * 2.3)) * abs(sin(vIW.z * 0.8 + sin(vIW.x * 0.6) * 2.1));
          totalEmissiveRadiance += vec3(0.13, 0.3, 0.34) * uIceLight * (0.75 + (1.0 - smoothstep(0.0, 0.05, cr)) * 0.8);
        }`).replace('#include <color_fragment>', `#include <color_fragment>
        {
          // hairline cracks and trapped bubbles in the ice
          vec2 q = vIW.xz;
          float c1 = abs(sin(q.x * 0.9 + sin(q.y * 0.55) * 2.3 + sin(q.y * 1.7) * 0.4));
          float c2 = abs(sin(q.y * 0.8 + sin(q.x * 0.6) * 2.1 + sin(q.x * 2.1) * 0.35));
          float crack = (1.0 - smoothstep(0.0, 0.035, c1)) + (1.0 - smoothstep(0.0, 0.03, c2)) * 0.7;
          float b = fract(sin(dot(floor(q * 6.0), vec2(12.9898, 78.233))) * 43758.5453);
          float top = step(${(ICE_TOP - 0.05).toFixed(2)}, vIW.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 1.0), clamp(crack, 0.0, 1.0) * 0.55 * top);
          diffuseColor.rgb += step(0.985, b) * 0.12 * top;
        }`);
    };
    mat.customProgramCacheKey = () => 'lakeice';
    this.mat = mat;
    // floating shards in broken holes
    const sg = new THREE.IcosahedronGeometry(1, 0); sg.scale(0.42, 0.09, 0.32);
    this.shards = new THREE.InstancedMesh(sg, new THREE.MeshPhongMaterial({ color: 0xdbe9f3, shininess: 120, specular: 0x9fb6c6, flatShading: true }), 400);
    this.shards.count = 0; this.shards.frustumCulled = false; scene.add(this.shards);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
  }

  clearAll() {
    for (const m of [...this.near.values(), ...this.far.values()]) if (m) { this.scene.remove(m); m.geometry.dispose(); }
    this.near.clear(); this.far.clear();
  }

  update(dt, cam, t) {
    const F = this.field;
    if (!F.frozen) { if (this.near.size || this.far.size) this.clearAll(); this.shards.count = 0; this.rev = F.rev; this.win = null; this.queue.length = 0; return; }
    if (F.rev !== this.rev) {
      // holes changed: re-cut the fine chunks (holes only exist there)
      this.rev = F.rev;
      for (const k of this.near.keys()) this.queue.push(['n', k]);
    }
    const ci = Math.floor(cam.x / NEAR), cj = Math.floor(cam.z / NEAR);
    const win = [ci - NEAR_R, ci + NEAR_R, cj - NEAR_R, cj + NEAR_R];
    const winMoved = !this.win || win[0] !== this.win[0] || win[2] !== this.win[2];
    if (winMoved) {
      const old = this.win; this.win = win;
      for (const [k, m] of this.near) { const [i, j] = ij(k); if (i < win[0] || i > win[1] || j < win[2] || j > win[3]) { if (m) { this.scene.remove(m); m.geometry.dispose(); } this.near.delete(k); } }
      for (let i = win[0]; i <= win[1]; i++) for (let j = win[2]; j <= win[3]; j++) if (!this.near.has(nk(i, j))) this.queue.unshift(['n', nk(i, j)]);
      // far chunks overlapping the old or the new window need their hole for the fine ice re-cut
      const fi = Math.floor(cam.x / FAR), fj = Math.floor(cam.z / FAR);
      for (const [k, m] of this.far) { const [i, j] = ij(k); if (Math.abs(i - fi) > FAR_R + 1 || Math.abs(j - fj) > FAR_R + 1) { if (m) { this.scene.remove(m); m.geometry.dispose(); } this.far.delete(k); } }
      for (let i = fi - FAR_R; i <= fi + FAR_R; i++) for (let j = fj - FAR_R; j <= fj + FAR_R; j++) {
        const k = nk(i, j), touch = (w) => w && i * FAR < (w[1] + 1) * NEAR && (i + 1) * FAR > w[0] * NEAR && j * FAR < (w[3] + 1) * NEAR && (j + 1) * FAR > w[2] * NEAR;
        if (!this.far.has(k) || touch(old) || touch(win)) this.queue.push(['f', k]);
      }
    }
    // build a few chunks per frame
    let budget = 3;
    const seen = new Set();
    while (budget > 0 && this.queue.length) {
      const [kind, k] = this.queue.shift();
      if (seen.has(kind + k)) continue; seen.add(kind + k);
      const [i, j] = ij(k);
      if (kind === 'n' && (i < this.win[0] || i > this.win[1] || j < this.win[2] || j > this.win[3])) continue;
      const map = kind === 'n' ? this.near : this.far;
      const old = map.get(k);
      const mesh = kind === 'n' ? this.buildNear(i, j) : this.buildFar(i, j);
      if (old) { this.scene.remove(old); old.geometry.dispose(); }
      map.set(k, mesh);
      if (mesh) this.scene.add(mesh);
      budget--;
    }
    this.updateShards(cam, t);
  }

  // corner positions are shared by every cell touching them, so the jitter never opens seams
  corner(ci, cj) {
    const F = this.field;
    let jag = false;
    for (let a = -2; a <= 1 && !jag; a++) for (let b = -2; b <= 1; b++) if (F.holeCell(ci + a, cj + b)) { jag = true; break; }
    if (!jag) return [ci * ICE_CELL, cj * ICE_CELL];
    return [ci * ICE_CELL + (hash3(ci, cj, 11) - 0.5) * 0.34, cj * ICE_CELL + (hash3(ci, cj, 13) - 0.5) * 0.34];
  }
  tint(x, z, edge, out) {
    const n = this.world.nDetail.noise(x / 23, z / 23) * 0.5 + this.world.nDetail.noise(x / 6, z / 6) * 0.25;
    // clear black-blue ice, milky white ice and snow drifts
    const snow = Math.max(0, Math.min(1, n * 1.6 + 0.25));
    out[0] = 0.42 + snow * 0.48 + edge * 0.25; out[1] = 0.58 + snow * 0.35 + edge * 0.2; out[2] = 0.7 + snow * 0.27 + edge * 0.1;
    for (let k = 0; k < 3; k++) out[k] = Math.min(1, out[k]);
    return out;
  }

  buildNear(I, J) {
    const F = this.field, n = Math.round(NEAR / ICE_CELL), i0 = I * n, j0 = J * n;
    const pos = [], col = [], c = [0, 0, 0];
    const solid = (i, j) => F.cellSolid(i, j);
    let any = false;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const i = i0 + a, j = j0 + b;
      if (!solid(i, j)) continue;
      any = true;
      const ns = [solid(i - 1, j), solid(i + 1, j), solid(i, j - 1), solid(i, j + 1)];
      const edge = ns.some((v) => !v);
      const hole = F.holeCell(i - 1, j) || F.holeCell(i + 1, j) || F.holeCell(i, j - 1) || F.holeCell(i, j + 1);
      // corners near a broken hole are jittered so the edge looks smashed, not gridded
      const p00 = this.corner(i, j), p10 = this.corner(i + 1, j), p11 = this.corner(i + 1, j + 1), p01 = this.corner(i, j + 1);
      const h = (ci, cj) => ICE_TOP + (hash3(ci, cj, 5) - 0.5) * 0.02;
      const y00 = h(i, j), y10 = h(i + 1, j), y11 = h(i + 1, j + 1), y01 = h(i, j + 1);
      this.tint(p00[0], p00[1], hole ? 0.22 : 0, c);
      const quad = (A, B, C, D, cc) => { pos.push(...A, ...B, ...C, ...A, ...C, ...D); for (let k = 0; k < 6; k++) col.push(...cc); };
      quad([p00[0], y00, p00[1]], [p01[0], y01, p01[1]], [p11[0], y11, p11[1]], [p10[0], y10, p10[1]], c);
      // underside, seen from below the ice
      const u = [0.2, 0.33, 0.38];
      quad([p00[0], ICE_BOT, p00[1]], [p10[0], ICE_BOT, p10[1]], [p11[0], ICE_BOT, p11[1]], [p01[0], ICE_BOT, p01[1]], u);
      if (edge) {
        // broken edges show the slab's thickness: clear blue-green inside, white rim
        const sc = [0.55, 0.72, 0.78];
        if (!ns[0]) quad([p00[0], y00, p00[1]], [p00[0], ICE_BOT, p00[1]], [p01[0], ICE_BOT, p01[1]], [p01[0], y01, p01[1]], sc);
        if (!ns[1]) quad([p10[0], y10, p10[1]], [p11[0], y11, p11[1]], [p11[0], ICE_BOT, p11[1]], [p10[0], ICE_BOT, p10[1]], sc);
        if (!ns[2]) quad([p00[0], y00, p00[1]], [p10[0], y10, p10[1]], [p10[0], ICE_BOT, p10[1]], [p00[0], ICE_BOT, p00[1]], sc);
        if (!ns[3]) quad([p01[0], y01, p01[1]], [p01[0], ICE_BOT, p01[1]], [p11[0], ICE_BOT, p11[1]], [p11[0], y11, p11[1]], sc);
      }
    }
    if (!any) return null;
    return this.mesh(pos, col);
  }

  buildFar(I, J) {
    const F = this.field, n = FAR / FAR_CELL, x0 = I * FAR, z0 = J * FAR, w = this.win;
    const pos = [], col = [], c = [0, 0, 0];
    let any = false;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const x = x0 + a * FAR_CELL, z = z0 + b * FAR_CELL;
      const cx = x + FAR_CELL / 2, cz = z + FAR_CELL / 2;
      if (w && cx > w[0] * NEAR && cx < (w[1] + 1) * NEAR && cz > w[2] * NEAR && cz < (w[3] + 1) * NEAR) continue; // fine ice there
      if (!F.lakeAt(cx, cz)) continue;
      any = true;
      this.tint(cx, cz, 0, c);
      const y = ICE_TOP - 0.01, X = x + FAR_CELL, Z = z + FAR_CELL;
      pos.push(x, y, z, x, y, Z, X, y, Z, x, y, z, X, y, Z, X, y, z);
      for (let k = 0; k < 6; k++) col.push(...c);
    }
    if (!any) return null;
    return this.mesh(pos, col);
  }

  mesh(pos, col) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.mat);
    m.receiveShadow = true;
    return m;
  }

  updateShards(cam, t) {
    let n = 0;
    const m = this._m, q = this._q, e = this._e, p = this._p, s = this._s;
    for (const h of this.field.holes) {
      if (Math.abs(h.x - cam.x) > 150 || Math.abs(h.z - cam.z) > 150) continue;
      const seed = h.id.length * 31 + Math.floor(h.x * 7) + Math.floor(h.z * 13);
      for (let k = 0; k < 7 && n < 400; k++) {
        const a = hash3(seed, k, 1) * Math.PI * 2, r = Math.sqrt(hash3(seed, k, 2)) * h.r * 0.72;
        const drift = t * 0.05 + k;
        const x = h.x + Math.cos(a + Math.sin(drift) * 0.15) * r, z = h.z + Math.sin(a + Math.sin(drift) * 0.15) * r;
        e.set(Math.sin(t * 0.9 + k) * 0.08, a + Math.sin(drift * 0.7) * 0.3, Math.cos(t * 0.8 + k * 2) * 0.08);
        p.set(x, 0.01 + Math.sin(t * 1.3 + k * 1.7) * 0.03, z);
        const sc = 0.6 + hash3(seed, k, 3) * 0.9;
        m.compose(p, q.setFromEuler(e), s.set(sc, 1, sc * (0.7 + hash3(seed, k, 4) * 0.6)));
        this.shards.setMatrixAt(n++, m);
      }
    }
    this.shards.count = n;
    this.shards.instanceMatrix.needsUpdate = true;
  }
}
