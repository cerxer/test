// Day/night cycle: gradient sky dome, sun, moon, stars, blocky clouds and scene lights.
import * as THREE from '../../lib/three.module.min.js';
import { SimplexNoise } from '../engine/noise.js';

const DAY_TOP = new THREE.Color(0x5f97ff);
const DAY_HORIZON = new THREE.Color(0xc4dcff);
const NIGHT_TOP = new THREE.Color(0x03050c);
const NIGHT_HORIZON = new THREE.Color(0x0c1226);
const SUNSET = new THREE.Color(0xff8a3c);

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function pixelCanvas(size, paint) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

export class Sky {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.domeUniforms = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uGlow: { value: new THREE.Color() },
      uGlowAmt: { value: 0 },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(450, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.domeUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: `
          uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uGlow; uniform float uGlowAmt;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 col = mix(uHorizon, uTop, smoothstep(-0.02, 0.5, h));
            col = mix(col, uHorizon * 0.8, smoothstep(0.0, -0.3, h));
            float s = max(dot(d, normalize(uSunDir)), 0.0);
            float band = 1.0 - smoothstep(0.0, 0.55, abs(h));
            col = mix(col, uGlow, pow(s, 5.0) * uGlowAmt * band);
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    dome.renderOrder = -100;
    dome.frustumCulled = false;
    this.dome = dome;
    this.group.add(dome);

    // Stars
    const starPos = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      starPos[i * 3] = r * Math.cos(a) * 400;
      starPos[i * 3 + 1] = u * 400;
      starPos[i * 3 + 2] = r * Math.sin(a) * 400;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.7, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.renderOrder = -99;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    const sunTex = pixelCanvas(32, (ctx) => {
      ctx.fillStyle = 'rgba(255,240,170,0.35)';
      ctx.fillRect(2, 2, 28, 28);
      ctx.fillStyle = 'rgba(255,245,190,0.6)';
      ctx.fillRect(5, 5, 22, 22);
      ctx.fillStyle = '#fffbe0';
      ctx.fillRect(8, 8, 16, 16);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(10, 10, 12, 12);
    });
    const moonTex = pixelCanvas(32, (ctx) => {
      ctx.fillStyle = 'rgba(200,210,255,0.15)';
      ctx.fillRect(4, 4, 24, 24);
      ctx.fillStyle = '#e8ecf4';
      ctx.fillRect(9, 9, 14, 14);
      ctx.fillStyle = '#b8bcc8';
      [[11, 11, 3, 3], [17, 13, 4, 3], [12, 18, 2, 2], [18, 19, 3, 2]].forEach((r) => ctx.fillRect(...r));
    });
    const celestial = (tex) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(80, 80),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
      m.renderOrder = -98;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    this.sun = celestial(sunTex);
    this.moon = celestial(moonTex);

    // Clouds: a world-anchored pixel mask sampled in a shader so the plane can follow the camera.
    const noise = new SimplexNoise(4242);
    const cloudTex = pixelCanvas(64, (ctx, s) => {
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        const a = x / s * Math.PI * 2, b = y / s * Math.PI * 2;
        const n = noise.noise3D(Math.cos(a) * 1.6, Math.sin(a) * 1.6, Math.cos(b) * 1.6 + Math.sin(b) * 0.9) * 0.7 +
          noise.noise3D(Math.cos(a) * 3.5 + 9, Math.sin(a) * 3.5, Math.sin(b) * 3.5) * 0.3;
        if (n > 0.18) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, 1, 1); }
      }
    });
    cloudTex.wrapS = cloudTex.wrapT = THREE.RepeatWrapping;
    this.cloudUniforms = {
      uMap: { value: cloudTex },
      uOffset: { value: new THREE.Vector2() },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uCam: { value: new THREE.Vector3() },
      uFade: { value: 380 },
    };
    const clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(1000, 1000),
      new THREE.ShaderMaterial({
        uniforms: this.cloudUniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: `
          varying vec3 vWorld;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: `
          uniform sampler2D uMap; uniform vec2 uOffset; uniform vec3 uColor; uniform vec3 uCam; uniform float uFade;
          varying vec3 vWorld;
          void main() {
            vec2 uv = (vWorld.xz + uOffset) / 768.0;
            float a = texture2D(uMap, uv).r;
            float d = length(vWorld.xz - uCam.xz);
            a *= 0.82 * (1.0 - smoothstep(uFade * 0.55, uFade, d));
            if (a < 0.01) discard;
            gl_FragColor = vec4(uColor, a);
          }`,
      }),
    );
    clouds.rotation.x = -Math.PI / 2;
    clouds.frustumCulled = false;
    clouds.renderOrder = 10;
    this.clouds = clouds;
    scene.add(clouds);
    this.cloudDrift = 0;

    this.ambient = new THREE.AmbientLight(0xffffff, Math.PI * 0.62);
    this.sunLightObj = new THREE.DirectionalLight(0xffffff, Math.PI * 0.5);
    this.sunLightObj.position.set(0.4, 1, 0.3);
    scene.add(this.ambient);
    scene.add(this.sunLightObj);
    scene.add(this.sunLightObj.target);

    this.daylight = 1;
    this.sunLight = 1;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.fogColor = new THREE.Color();
    this.skyTop = new THREE.Color();
  }

  // t in [0,1): 0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight.
  update(dt, t, camera) {
    const ang = t * Math.PI * 2;
    this.sunDir.set(Math.cos(ang), Math.sin(ang), 0.25).normalize();
    const e = this.sunDir.y;
    this.daylight = smoothstep(-0.16, 0.24, e);
    this.sunLight = 0.14 + 0.86 * this.daylight;
    const sunset = Math.exp(-(e * e) / 0.025) * 0.9;

    this.skyTop.copy(NIGHT_TOP).lerp(DAY_TOP, this.daylight);
    this.fogColor.copy(NIGHT_HORIZON).lerp(DAY_HORIZON, this.daylight);
    this.fogColor.lerp(SUNSET, sunset * 0.35);
    this.domeUniforms.uTop.value.copy(this.skyTop);
    this.domeUniforms.uHorizon.value.copy(this.fogColor);
    this.domeUniforms.uSunDir.value.copy(this.sunDir);
    this.domeUniforms.uGlow.value.copy(SUNSET);
    this.domeUniforms.uGlowAmt.value = sunset;

    const cp = camera.position;
    this.group.position.copy(cp);
    this.sun.position.copy(this.sunDir).multiplyScalar(320);
    this.moon.position.copy(this.sunDir).multiplyScalar(-320);
    this.sun.lookAt(cp.x, cp.y, cp.z);
    this.moon.lookAt(cp.x, cp.y, cp.z);
    this.sun.material.opacity = smoothstep(-0.25, 0.05, e);
    this.moon.material.opacity = smoothstep(0.25, -0.05, e);
    this.starMat.opacity = Math.max(0, 1 - this.daylight * 1.3) * 0.9;
    this.stars.rotation.z = ang;

    this.cloudDrift += dt * 1.2;
    this.clouds.position.set(cp.x, 140, cp.z);
    this.cloudUniforms.uOffset.value.set(this.cloudDrift, 0);
    this.cloudUniforms.uCam.value.copy(cp);
    const cb = 0.1 + 0.9 * this.daylight;
    this.cloudUniforms.uColor.value.setRGB(cb, cb, cb * 1.02).lerp(SUNSET, sunset * 0.3);
    this.clouds.visible = this.game.settings.clouds !== false;

    // Scene lights keep constant intensity: mobs are tinted by local light separately.
    const lightDir = e > -0.05 ? this.sunDir : this.sunDir.clone().negate();
    this.sunLightObj.position.copy(lightDir).multiplyScalar(10);
  }
}
