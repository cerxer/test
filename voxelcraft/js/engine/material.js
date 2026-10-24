// Chunk shaders: texture-array sampling, smooth sky/block light, AO, directional sun shading, fog.
import * as THREE from '../../lib/three.module.min.js';

const vertexShader = /* glsl */ `
attribute vec4 data;
uniform vec3 uSunDir;
varying vec2 vUv;
flat varying float vLayer;
varying vec2 vLight;
varying float vShade;
varying float vSun;
varying float vFog;
const vec3 NORMALS[6] = vec3[6](vec3(1.0, 0.0, 0.0), vec3(-1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0),
  vec3(0.0, -1.0, 0.0), vec3(0.0, 0.0, 1.0), vec3(0.0, 0.0, -1.0));
void main() {
  vUv = uv;
  vLayer = data.x;
  vLight = data.yz / 255.0;
  float occ = floor(data.w / 8.0);
  int face = int(data.w - occ * 8.0 + 0.5);
  float shade;
  if (face < 6) {
    shade = face == 2 ? 1.0 : (face == 3 ? 0.55 : (face < 2 ? 0.72 : 0.84));
    vSun = max(dot(NORMALS[face], uSunDir), 0.0);
  } else {
    shade = 0.9;
    vSun = 0.5;
  }
  vShade = shade * (1.0 - occ * 0.19);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFog = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform float uSunLight;
uniform float uDirStrength;
uniform float uMinLight;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;
uniform float uTime;
uniform float uAlpha;
uniform float uBrightness;
varying vec2 vUv;
flat varying float vLayer;
varying vec2 vLight;
varying float vShade;
varying float vSun;
varying float vFog;
float curve(float l) { return l / (2.4 * (1.0 - l) + 1.0); }
void main() {
  vec2 uv = vUv;
#ifdef WATER
  uv += vec2(uTime * 0.02, uTime * 0.05);
#endif
  vec4 tex = texture(uAtlas, vec3(uv, vLayer));
#ifndef WATER
  if (tex.a < 0.5) discard;
#endif
  float sky = curve(vLight.x) * uSunLight;
  float blk = curve(vLight.y);
  float dir = 1.0 + uDirStrength * (vSun * 0.2 - 0.14);
  vec3 light = max(vec3(sky * dir), vec3(blk) * vec3(1.0, 0.86, 0.66)) * uBrightness;
  light += vec3(uMinLight) * max(vec3(1.0) - light, vec3(0.0));
  vec3 col = tex.rgb * light * vShade;
  float fog = smoothstep(uFogNear, uFogFar, vFog);
  col = mix(col, uFogColor, fog);
#ifdef WATER
  gl_FragColor = vec4(col, mix(tex.a * uAlpha, 1.0, fog * 0.6));
#else
  gl_FragColor = vec4(col, 1.0);
#endif
}
`;

export function createChunkMaterials(atlas) {
  const uniforms = {
    uAtlas: { value: atlas },
    uSunLight: { value: 1 },
    uSunDir: { value: new THREE.Vector3(0.3, 0.9, 0.2).normalize() },
    uDirStrength: { value: 1 },
    uMinLight: { value: 0.04 },
    uFogNear: { value: 60 },
    uFogFar: { value: 100 },
    uFogColor: { value: new THREE.Color(0xbcd6ff) },
    uTime: { value: 0 },
    uAlpha: { value: 1 },
    uBrightness: { value: 1 },
  };
  const opaque = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.FrontSide,
  });
  const waterUniforms = Object.assign({}, uniforms, { uAlpha: { value: 0.82 } });
  const water = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader,
    fragmentShader,
    defines: { WATER: 1 },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return { opaque, water, uniforms };
}
