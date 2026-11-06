// Seasonal look, injected into the world's materials: snow settles on upward-facing surfaces (not the hot
// desert sand), hoarfrost glazes everything with a cold sheen and ice glints, deciduous leaves / grass /
// ferns turn gold and red in autumn, flowers bloom in spring and wither in winter, grass is pressed flat
// and frozen under the snow.
import * as THREE from 'three';
import { MAT } from './models.js';

export const SEASON = { uSnow: { value: 0 }, uFrost: { value: 0 }, uAutumn: { value: 0 }, uBloom: { value: 1 } };

// modes: ground | world | tree (deciduous) | pine | grass | flower | plant
const SNOW_RANGE = { ground: [0.5, 0.82], world: [0.55, 0.85], tree: [0.15, 0.6], pine: [0.0, 0.45], grass: [0, 1], flower: [0.2, 0.8], plant: [0.2, 0.7] };

export function injectSeason(sh, mode) {
  Object.assign(sh.uniforms, SEASON);
  const [lo, hi] = SNOW_RANGE[mode] || [0.5, 0.85];
  const defs = `#define S_LO ${lo.toFixed(2)}\n#define S_HI ${hi.toFixed(2)}\n` + (mode === 'ground' ? '#define S_GROUND\n' : '') + (mode === 'grass' ? '#define S_GRASS\n' : '') + (['tree', 'grass', 'plant'].includes(mode) ? '#define S_AUTUMN\n' : '');
  const uni = 'uniform float uSnow;\nuniform float uFrost;\nuniform float uAutumn;\nuniform float uBloom;\nvarying float vSUp;\nvarying vec3 vSPos;\nvarying float vSH;\n';
  let vs = sh.vertexShader;
  vs = defs + uni + vs.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
    {
      vec3 sn = objectNormal;
      #ifdef USE_INSTANCING
        sn = mat3(instanceMatrix) * sn;
      #endif
      vSUp = normalize(mat3(modelMatrix) * sn).y;
    }`);
  vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>
    vSH = clamp(position.y / 0.6, 0.0, 1.0);
    ${mode === 'grass' ? 'transformed.y *= 1.0 - uSnow * 0.72; transformed.xz *= 1.0 + uSnow * 0.25;' : ''}
    ${mode === 'flower' ? 'transformed *= clamp(uBloom, 0.0, 1.2);' : ''}
    ${mode === 'plant' ? 'transformed.y *= 1.0 - uSnow * 0.35;' : ''}`);
  vs = vs.replace('#include <project_vertex>', `#include <project_vertex>
    {
      vec4 swp = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        swp = instanceMatrix * swp;
      #endif
      vSPos = (modelMatrix * swp).xyz;
    }`);
  sh.vertexShader = vs;
  sh.fragmentShader = defs + uni + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    {
      vec3 c = diffuseColor.rgb;
      float lum = dot(c, vec3(0.3, 0.59, 0.11));
      float h = fract(sin(dot(floor(vSPos.xz * 0.12), vec2(12.9898, 78.233))) * 43758.5453);
      #ifdef S_AUTUMN
        float green = clamp((c.g - max(c.r, c.b)) * 7.0, 0.0, 1.0);
        vec3 aut = mix(vec3(0.86, 0.43, 0.1), vec3(0.72, 0.17, 0.08), h);
        aut = mix(aut, vec3(0.92, 0.72, 0.18), step(0.62, h));
        #ifdef S_GRASS
          aut = vec3(0.72, 0.6, 0.28);
        #endif
        c = mix(c, aut * (0.55 + lum * 1.2), green * uAutumn);
      #endif
      // hoarfrost: cold blue-white sheen over everything outdoors
      c = mix(c, c * vec3(0.8, 0.9, 1.06) + vec3(0.1, 0.12, 0.17), uFrost * 0.42);
      // snow lying on upward faces
      float cover = uSnow * smoothstep(S_LO, S_HI, vSUp);
      #ifdef S_GROUND
        float sandy = smoothstep(0.1, 0.22, diffuseColor.r - diffuseColor.b) * step(0.45, diffuseColor.r) * step(diffuseColor.g, diffuseColor.r + 0.02);
        cover *= 1.0 - sandy * 0.92;
      #endif
      float n = fract(sin(dot(floor(vSPos.xz * 1.7), vec2(12.9898, 78.233))) * 43758.5453);
      cover = clamp(cover * 1.25 - n * 0.3 * (1.0 - uSnow), 0.0, 1.0);
      #ifdef S_GRASS
        cover = uSnow * clamp(vSH * 1.4 + 0.45, 0.0, 1.0);
      #endif
      c = mix(c, vec3(0.9, 0.93, 0.985) * (0.95 + n * 0.08), cover);
      // ice crystals glinting in the snow
      float sp = fract(sin(dot(floor(vSPos * 9.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      c += step(0.9965, sp) * (cover + uFrost * 0.3) * 0.45;
      if (vSPos.y < -120.0) c = diffuseColor.rgb; // never underground
      diffuseColor.rgb = c;
    }`);
}

// apply to a material in place (keeps the same object so other code can still tweak it)
export function applySeason(mat, mode) {
  mat.onBeforeCompile = (sh) => injectSeason(sh, mode);
  mat.customProgramCacheKey = () => 'season:' + mode;
  mat.needsUpdate = true;
  return mat;
}
// rocks, monument props, pickables, roofs
export const WORLD_MAT = applySeason(MAT.clone(), 'world');

// footprint / track shapes
export function footprintGeometry(kind) {
  const g = new THREE.BufferGeometry();
  if (kind === 2) { const b = new THREE.PlaneGeometry(0.32, 1.6, 1, 4); b.rotateX(-Math.PI / 2); return b; }
  const sole = new THREE.CircleGeometry(0.055, 8); sole.scale(1, 1.9, 1); sole.translate(0, 0.05, 0);
  const heel = new THREE.CircleGeometry(0.045, 7); heel.translate(0, -0.1, 0);
  const pos = [...sole.toNonIndexed().attributes.position.array, ...heel.toNonIndexed().attributes.position.array];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}
