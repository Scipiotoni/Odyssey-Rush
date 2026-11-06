// Sky dome, sun/moon lighting, fog, stars and low-poly animated water.
import * as THREE from 'three';
import { lerp, clamp } from '/shared/noise.js';

const DAY_TOP = new THREE.Color(0x3d7fc4), DAY_HOR = new THREE.Color(0xb9d6e8);
const SET_TOP = new THREE.Color(0x3a4a7a), SET_HOR = new THREE.Color(0xe8a070);
const NIGHT_TOP = new THREE.Color(0x05070f), NIGHT_HOR = new THREE.Color(0x141c2c);

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.uniforms = { top: { value: DAY_TOP.clone() }, hor: { value: DAY_HOR.clone() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(0xfff0c0) } };
    const geo = new THREE.SphereGeometry(4000, 24, 12);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.9999; }`,
      fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y, 0.0, 1.0); vec3 c = mix(hor, top, pow(h, 0.55));
          if (vDir.y < 0.0) c = hor * 0.85;
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          c += sunCol * (pow(s, 900.0) * 1.6 + pow(s, 12.0) * 0.18);
          vec3 md = -sunDir; float m = max(dot(normalize(vDir), md), 0.0);
          c += vec3(0.85,0.9,1.0) * pow(m, 1500.0) * 1.2;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // stars
    const sg = new THREE.BufferGeometry(), sp = [];
    for (let i = 0; i < 1500; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      if (u < 0.05) continue;
      sp.push(Math.cos(a) * r * 3800, u * 3800, Math.sin(a) * r * 3800);
    }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a4a30, 0.9);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d0, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun); scene.add(this.sun.target);
    scene.fog = new THREE.Fog(0xb9d6e8, 100, 900);

    // water
    const wg = new THREE.PlaneGeometry(3200, 3200, 80, 80);
    wg.rotateX(-Math.PI / 2);
    this.waterUniforms = { uTime: { value: 0 } };
    const wm = new THREE.MeshPhongMaterial({ color: 0x2a6f9a, transparent: true, opacity: 0.82, flatShading: true, shininess: 80, specular: 0x557788 });
    wm.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.waterUniforms.uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float dd = length(position.xz);
        float amp = 0.35 * (1.0 - smoothstep(300.0, 1400.0, dd));
        amp *= mix(0.22, 1.0, smoothstep(4200.0, 6000.0, length(wp.xz))); // lakes and rivers inland are calm
        transformed.y += (sin(wp.x * 0.11 + uTime * 1.3) * cos(wp.z * 0.13 + uTime * 1.1) + sin((wp.x + wp.z) * 0.05 + uTime * 0.7) * 0.6) * amp;`);
    };
    this.water = new THREE.Mesh(wg, wm);
    this.water.receiveShadow = false;
    scene.add(this.water);
    this.dayLight = 1;
  }

  // day: 0..1 (0 = midnight, 0.5 = noon)
  update(day, camPos, dt, viewDist) {
    this.waterUniforms.uTime.value += dt;
    const ang = (day - 0.25) * Math.PI * 2; // sunrise at 0.25
    const sx = Math.cos(ang), sy = Math.sin(ang);
    const sunDir = new THREE.Vector3(sx * 0.9, sy, 0.35).normalize();
    this.uniforms.sunDir.value.copy(sunDir);
    const dayF = clamp((sy + 0.12) / 0.4, 0, 1);       // 0 night, 1 day
    const setF = clamp(1 - Math.abs(sy) / 0.35, 0, 1);  // near horizon
    const top = NIGHT_TOP.clone().lerp(DAY_TOP, dayF).lerp(SET_TOP, setF * 0.6 * dayF);
    const hor = NIGHT_HOR.clone().lerp(DAY_HOR, dayF).lerp(SET_HOR, setF * 0.7);
    this.uniforms.top.value.copy(top); this.uniforms.hor.value.copy(hor);
    this.uniforms.sunCol.value.setRGB(1, lerp(0.6, 0.95, dayF), lerp(0.3, 0.8, dayF)).multiplyScalar(sy > -0.05 ? 1 : 0);
    this.scene.fog.color.copy(hor);
    this.scene.fog.far = viewDist; this.scene.fog.near = viewDist * 0.15;
    this.starMat.opacity = clamp(1 - dayF * 1.5, 0, 1);
    this.dome.position.copy(camPos); this.stars.position.copy(camPos);
    this.stars.rotation.y = day * Math.PI * 2;
    const moon = sy < 0;
    const ld = moon ? sunDir.clone().negate() : sunDir;
    this.sun.position.copy(camPos).addScaledVector(ld, 200);
    this.sun.target.position.copy(camPos);
    // snap shadow camera to texels to reduce shimmering
    this.sun.intensity = moon ? 0.25 : lerp(0.0, 1.7, dayF);
    this.sun.color.setRGB(moon ? 0.6 : 1, moon ? 0.7 : lerp(0.7, 0.95, dayF), moon ? 1 : lerp(0.5, 0.85, dayF));
    this.hemi.intensity = lerp(0.18, 0.95, dayF);
    this.hemi.color.setRGB(lerp(0.35, 0.75, dayF), lerp(0.4, 0.85, dayF), lerp(0.6, 1.0, dayF));
    this.hemi.groundColor.setHex(0x5a4a30);
    this.water.position.set(Math.round(camPos.x / 40) * 40, 0, Math.round(camPos.z / 40) * 40);
    this.water.material.color.setRGB(lerp(0.04, 0.16, dayF), lerp(0.1, 0.43, dayF), lerp(0.16, 0.6, dayF));
    this.dayLight = dayF;
  }
}
