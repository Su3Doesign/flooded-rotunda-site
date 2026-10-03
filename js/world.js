// The rotunda, live: loads the exported Blender world, rebuilds its materials (stone + moss + grime + waterline masks,
// the same ones Unreal reads), scatters the foliage as instanced meshes, and renders it through a
// sketch <-> render "concept" pass. Coordinates: three.js frame, Y up, metres.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const NOISE = /* glsl */`
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm2(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
`;

// shared uniforms (every patched material points at these objects)
export const G = {
  uTime: { value: 0 },
  uMode: { value: 0 },            // 0 final  1 clay  2 masks  3 light only
  uClipY: { value: 1000 },
  uWaterY: { value: 0 },
  uSunCol: { value: new THREE.Color(1.0, 0.9, 0.74) },
  uPoche: { value: new THREE.Color(0.42, 0.06, 0.05) },
  uPocheK: { value: 0 },          // section fill on back faces (plan view only)
  uDomeCut: { value: 0 },         // 0 = roof on, 1 = roof erased (dissolve; it still casts its shadow)
  tCaustics: { value: null },
  tMacro: { value: null },
  tMossBC: { value: null },
  tMossN: { value: null },
  tMossORH: { value: null },
  tNoise: { value: null },
};

const QUALITY = {
  low: { dpr: 1.0, frac: 0.22, shadow: 2048, bloom: false, msaa: 0, dust: 900 },
  medium: { dpr: 1.25, frac: 0.45, shadow: 2048, bloom: true, msaa: 2, dust: 1800 },
  high: { dpr: 1.75, frac: 1.0, shadow: 4096, bloom: true, msaa: 4, dust: 3600 },
};

const MODE_GLSL = /* glsl */`
  if (uMode > 0.5 && uMode < 1.5) diffuseColor.rgb = vec3(0.6);
  else if (uMode > 1.5 && uMode < 2.5) diffuseColor.rgb = vec3(0.08, 0.62, 0.22);
  else if (uMode > 2.5) diffuseColor.rgb = vec3(0.74);
`;

function stonePatch(mat, key, opts = {}) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, G);
    sh.uniforms.tStoneORH = { value: mat.roughnessMap };
    sh.uniforms.uMossBoost = { value: opts.mossBoost ?? 0.0 };
    sh.uniforms.uMossTile = { value: opts.mossTile ?? 1.7 };
    sh.uniforms.uGrimeK = { value: opts.grimeK ?? 1.0 };
    sh.uniforms.uMacroK = { value: opts.macroK ?? 1.0 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 uv1;
attribute vec2 uv2;
varying vec4 vMasks;
varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vMasks = vec4(uv1.x, 1.0 - uv1.y, uv2.x, 1.0 - uv2.y);
vWPos = (modelMatrix * vec4(position, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uMode; uniform float uClipY; uniform float uWaterY;
uniform vec3 uSunCol; uniform vec3 uPoche;
uniform sampler2D tMossBC; uniform sampler2D tMossN; uniform sampler2D tMossORH;
uniform sampler2D tCaustics; uniform sampler2D tMacro; uniform sampler2D tStoneORH;
uniform float uMossBoost; uniform float uMossTile; uniform float uGrimeK; uniform float uMacroK;
uniform float uPocheK; uniform float uDomeCut;
varying vec4 vMasks; varying vec3 vWPos;
${NOISE}`)
      .replace('#include <map_fragment>', `
float dedge = 0.0;
${opts.dome ? `
if (uDomeCut > 0.001) {
  float dsv = fbm2(vWPos.xz * 0.21 + vec2(vWPos.y * 0.37, 0.0)) * 0.85 + vnoise(vWPos.xz * 3.1 + vWPos.y) * 0.15;
  float dcut = uDomeCut * 1.25 - 0.12;
  if (dsv < dcut) discard;
  dedge = 1.0 - smoothstep(dcut, dcut + 0.035, dsv);
}` : ''}
vec4 stoneTex = texture2D(map, vMapUv);
vec4 orh = texture2D(tStoneORH, vMapUv);
vec2 muv = vMapUv * uMossTile;
vec4 mossTex = texture2D(tMossBC, muv);
vec4 mossORH = texture2D(tMossORH, muv);
float macro = texture2D(tMacro, vWPos.xz * 0.031 + vec2(vWPos.y * 0.019, 0.0)).r;
float grime = vMasks.y;
float wet = vMasks.z;
float mossAmt = smoothstep(0.30, 0.62, clamp(vMasks.x + uMossBoost, 0.0, 1.0) * 1.06 + (orh.b - 0.5) * 0.5
                + (mossORH.b - 0.5) * 0.35 + (macro - 0.5) * 0.35);
vec3 alb = stoneTex.rgb * mix(1.0, 0.74 + 0.5 * macro, uMacroK);
alb *= mix(1.0, 0.58, grime * 0.8 * uGrimeK);
alb = mix(alb, alb * vec3(0.58, 0.64, 0.5), wet * 0.65);
vec3 mossCol = mossTex.rgb * mix(vec3(0.8, 0.92, 0.62), vec3(1.12, 1.06, 0.86), macro);
alb = mix(alb, mossCol, mossAmt);
float under = smoothstep(uWaterY + 0.02, uWaterY - 0.6, vWPos.y);
alb *= mix(vec3(1.0), vec3(0.36, 0.58, 0.4), under);
if (uMode > 0.5 && uMode < 1.5) alb = vec3(0.6);
else if (uMode > 1.5 && uMode < 2.5) alb = vec3(grime * 0.7, mossAmt * 0.85 + 0.04, wet * 0.8);
else if (uMode > 2.5) alb = vec3(0.74);
diffuseColor.rgb *= alb;`)
      .replace('#include <roughnessmap_fragment>', `
float roughnessFactor = roughness * mix(orh.g, clamp(mossORH.g * 1.08, 0.0, 1.0), mossAmt);
roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.42, wet * (1.0 - 0.5 * mossAmt));
if (uMode > 0.5) roughnessFactor = 0.86;`)
      .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `
vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
vec3 mossNn = texture2D( tMossN, vNormalMapUv * uMossTile ).xyz * 2.0 - 1.0;
mapN = normalize(mix(mapN, mossNn, mossAmt));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float uw = smoothstep(uWaterY, uWaterY - 0.12, vWPos.y) * smoothstep(-1.7, -0.25, vWPos.y);
vec2 cuv = vWPos.xz * 0.21;
float c1 = texture2D(tCaustics, cuv + vec2(uTime * 0.021, uTime * 0.013)).r;
float c2 = texture2D(tCaustics, cuv * 1.37 - vec2(uTime * 0.017, -uTime * 0.011)).r;
totalEmissiveRadiance += uSunCol * min(c1, c2) * uw * 0.5 * diffuseColor.rgb * step(uMode, 0.5);
totalEmissiveRadiance += vec3(0.95, 0.9, 0.8) * dedge * 2.2 * step(0.001, uDomeCut);`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
if (!gl_FrontFacing && uClipY < 200.0) gl_FragColor.rgb = mix(gl_FragColor.rgb, uPoche, uPocheK);`);
  };
  mat.customProgramCacheKey = () => 'stone-' + key + (opts.dome ? '-dome' : '');
}

function foliagePatch(mat, key, opts = {}) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, G);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vObj; varying vec3 vObjN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vObj = position; vObjN = normal;
#ifdef USE_INSTANCING
vWPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
#else
vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uMode; uniform float uWaterY; uniform vec3 uSunCol;
uniform sampler2D tMossBC; uniform sampler2D tCaustics;
varying vec3 vWPos; varying vec3 vObj; varying vec3 vObjN;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${opts.triplanar ? `
vec3 an = abs(normalize(vObjN)); an /= (an.x + an.y + an.z);
vec3 tri = texture2D(tMossBC, vObj.yz * 2.4).rgb * an.x + texture2D(tMossBC, vObj.xz * 2.4).rgb * an.y + texture2D(tMossBC, vObj.xy * 2.4).rgb * an.z;
diffuseColor.rgb *= tri * 1.25;` : ''}
float underF = smoothstep(uWaterY + 0.01, uWaterY - 0.45, vWPos.y);
diffuseColor.rgb *= mix(vec3(1.0), vec3(0.34, 0.56, 0.38), underF);
${MODE_GLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
${opts.translucent ? `totalEmissiveRadiance += diffuseColor.rgb * uSunCol * 0.05;` : ''}`);
  };
  mat.customProgramCacheKey = () => 'foliage-' + key;
}

function shaftMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: G.uTime, uClipY: G.uClipY, tNoise: G.tNoise, uIntensity: { value: 1 }, uColor: { value: new THREE.Color(1.0, 0.86, 0.66) }, uAxis: { value: new THREE.Vector3(0, 1, 0) } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uClipY; uniform float uIntensity; uniform vec3 uColor; uniform vec3 uAxis; uniform sampler2D tNoise;
      varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      void main(){
        if (vP.y > uClipY) discard;
        vec3 V = normalize(cameraPosition - vP);
        float edge = pow(abs(dot(normalize(vN), V)), 2.2);
        // looking up (or down) a shaft you see through all of it: brighter, not invisible
        float ax = abs(dot(V, normalize(uAxis)));
        edge = mix(edge, 0.5, smoothstep(0.45, 0.95, ax));
        float along = vUv.y;
        float fade = smoothstep(1.0, 0.9, along) * smoothstep(0.0, 0.22, along) * (0.45 + 0.55 * along);
        float n = texture2D(tNoise, (vP.xz + vP.y * vec2(0.61, -0.37)) * 0.025 + vec2(uTime * 0.0028, uTime * 0.0011)).b * 0.6
                + texture2D(tNoise, (vP.xz * 2.9 + vP.y * vec2(-1.3, 0.9)) * 0.025 - vec2(uTime * 0.0016)).r * 0.4;
        float a = edge * fade * (0.45 + 0.75 * n) * uIntensity * 0.3 * (1.0 + 0.5 * smoothstep(0.55, 1.0, ax));
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

function dustMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: G.uTime, uClipY: G.uClipY, uIntensity: { value: 1 }, uPx: { value: 1 }, uColor: { value: new THREE.Color(1.0, 0.9, 0.72) } },
    vertexShader: /* glsl */`
      attribute float aRand; attribute float aLit;
      uniform float uTime; uniform float uPx;
      varying float vA; varying float vY;
      void main(){
        vec3 p = position + vec3(sin(uTime * 0.11 + aRand * 31.0), sin(uTime * 0.05 + aRand * 13.0) * 0.6, cos(uTime * 0.09 + aRand * 17.0)) * 0.28;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min((2.0 + 3.0 * fract(aRand * 7.3)) * uPx * (6.0 / max(-mv.z, 0.5)), 6.0 * uPx);
        vA = aLit * (0.55 + 0.45 * sin(uTime * (0.6 + aRand) + aRand * 40.0));
        vY = (modelMatrix * vec4(p, 1.0)).y;
      }`,
    fragmentShader: /* glsl */`
      uniform float uIntensity; uniform vec3 uColor; uniform float uClipY;
      varying float vA; varying float vY;
      void main(){
        if (vY > uClipY) discard;
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vA * uIntensity;
        gl_FragColor = vec4(uColor * a * 1.6, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

function skyMaterial(sunDir) {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir.clone() }, uI: { value: 1 } },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize((modelMatrix * vec4(position, 1.0)).xyz); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun; uniform float uI; varying vec3 vD;
      void main(){
        float h = clamp(vD.y, 0.0, 1.0);
        vec3 c = mix(vec3(0.75, 0.82, 0.8), vec3(0.42, 0.56, 0.68), pow(h, 0.6)) * 2.2;
        float s = max(dot(normalize(vD), normalize(uSun)), 0.0);
        c += vec3(1.0, 0.86, 0.62) * (pow(s, 24.0) * 3.0 + pow(s, 600.0) * 40.0);
        c *= smoothstep(0.22, 0.5, vD.y);                       // the sky is only ever seen up through the dome
        gl_FragColor = vec4(c * uI, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
}

const POST_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const POST_FS = /* glsl */`
uniform sampler2D tScene; uniform sampler2D tDepth; uniform sampler2D tPaper; uniform sampler2D tNoise;
uniform vec2 uRes; uniform float uTime; uniform float uSketch; uniform float uPaperMode; uniform float uNear; uniform float uFar;
uniform float uVignette; uniform float uGrain; uniform float uFade; uniform vec3 uFadeColor; uniform float uCA; uniform float uPx; uniform float uGrade;
varying vec2 vUv;
#include <packing>
// all noise comes from one small precomputed texture: r,g = value noise, b = fbm (32 cells across, tileable)
vec4 tN(vec2 p){ return texture2D(tNoise, p * 0.03125); }
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float linDepth(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
vec3 tmap(vec3 c){
#ifdef TONE_MAPPING
  return toneMapping(c);
#else
  return clamp(c, 0.0, 1.0);
#endif
}
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float hatch(vec2 p, float ang, float spacing, float jit){
  vec2 d = vec2(cos(ang), sin(ang));
  float v = dot(p, vec2(-d.y, d.x)) / spacing;
  float along = dot(p, d);
  vec4 n = tN(p * 0.012 + jit);
  float f = abs(fract(v + (n.r - 0.5) * 0.7) - 0.5);
  float line = smoothstep(0.2, 0.04, f);
  float brk = smoothstep(0.22, 0.42, tN(vec2(along / (spacing * 10.0), floor(v) * 1.73) + jit * 3.1).g);
  return line * brk * (0.55 + 0.45 * n.b);
}
void main(){
  vec2 uv = vUv;
  vec2 cav = (uv - 0.5) * 0.004 * uCA;
  vec3 hdr = vec3(texture2D(tScene, uv + cav).r, texture2D(tScene, uv).g, texture2D(tScene, uv - cav).b);
  vec3 col = tmap(hdr);
  if (uSketch > 0.002) {
    // ink-wash dissolve mask first: pixels the sketch has not reached skip all the work below
    vec2 nuv = uv * vec2(uRes.x / uRes.y, 1.0);
    float n = tN(nuv * 1.7 + 3.1).b * 0.62 + tN(nuv * 5.3 - 1.7).b * 0.28 + tN(gl_FragCoord.xy * 0.09 / uPx).r * 0.1;
    float k = smoothstep(n - 0.11, n + 0.11, uSketch * 1.24 - 0.12);
    if (k > 0.002) {
      float tq = floor(uTime * 8.0);
      vec2 px = 1.0 / uRes;
      vec2 wob = (tN(uv * 6.0 + vec2(tq * 1.7, tq * 1.3)).rg - 0.5) * px * 3.0 * uPx;
      vec2 suv = uv + wob;
      float dxp = log(linDepth(suv + vec2(px.x, 0.0))), dxm = log(linDepth(suv - vec2(px.x, 0.0)));
      float dyp = log(linDepth(suv + vec2(0.0, px.y))), dym = log(linDepth(suv - vec2(0.0, px.y)));
      float eD = smoothstep(0.025, 0.11, length(vec2(dxp - dxm, dyp - dym)));
      vec2 o = px * 1.5;
      float lx = lum(tmap(texture2D(tScene, suv + vec2(o.x, 0.0)).rgb)) - lum(tmap(texture2D(tScene, suv - vec2(o.x, 0.0)).rgb));
      float ly = lum(tmap(texture2D(tScene, suv + vec2(0.0, o.y)).rgb)) - lum(tmap(texture2D(tScene, suv - vec2(0.0, o.y)).rgb));
      float eL = smoothstep(0.09, 0.32, length(vec2(lx, ly)));
      float edge = clamp(max(eD, eL * 0.85), 0.0, 1.0);
      float L = pow(lum(tmap(texture2D(tScene, suv).rgb)), 0.75);
      vec2 p = gl_FragCoord.xy / uPx;
      float sp = 6.0;
      // the three stroke layers are shared by both papers; only the tones that switch them on differ
      float h1 = hatch(p, 0.79, sp, tq), h2 = hatch(p, -0.79, sp, tq + 5.0), h3 = hatch(p, 0.12, sp * 0.75, tq + 9.0);
      float t = 1.0 - L;
      float ink = clamp(edge * 0.95 + (h1 * smoothstep(0.28, 0.5, t) + h2 * smoothstep(0.5, 0.72, t) + h3 * smoothstep(0.74, 0.92, t)) * 0.6, 0.0, 1.0);
      float chalk = clamp(edge * 0.85 + (h1 * smoothstep(0.24, 0.44, L) + h2 * smoothstep(0.46, 0.66, L) + h3 * smoothstep(0.7, 0.88, L)) * 0.6
                          + smoothstep(0.78, 1.0, L) * 0.4, 0.0, 1.0);
      // empty background is blank paper; its faint lines (the plan drawn on the ground) stay as pencil lines
      float isBg = step(0.999999, texture2D(tDepth, suv).x);
      float bgLine = smoothstep(0.06, 0.4, L) * (1.0 - smoothstep(0.65, 0.95, L));
      ink = mix(ink, bgLine * 0.85, isBg);
      chalk = mix(chalk, bgLine * 0.8 + smoothstep(0.7, 1.0, L) * 0.5, isBg);
      vec3 pt = texture2D(tPaper, gl_FragCoord.xy / (1024.0 * uPx)).rgb;
      vec3 dark = mix(vec3(0.011, 0.013, 0.011) * (0.65 + 0.7 * pt.r), vec3(0.78, 0.75, 0.69), chalk);
      vec3 cream = mix(pt, vec3(0.045, 0.04, 0.035), ink);
      vec3 sk = mix(dark, cream, uPaperMode);
      float red = smoothstep(0.08, 0.2, col.r - max(col.g, col.b) * 1.4);
      sk = mix(sk, vec3(0.42, 0.05, 0.04), red * 0.85);
      sk += (col - vec3(lum(col))) * mix(0.1, 0.2, uPaperMode);
      col = mix(col, sk, k);
    }
  }
  // grade: a touch of contrast, cool green-grey shadows, warm light (the Cycles keys)
  float gl = lum(col);
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.35 * uGrade);
  col *= mix(vec3(1.0), mix(vec3(0.9, 1.0, 0.98), vec3(1.04, 1.0, 0.94), smoothstep(0.05, 0.6, gl)), uGrade);
  col = mix(vec3(lum(col)), col, mix(1.0, 0.9, uGrade));
  float vig = smoothstep(1.3, 0.3, length((uv - 0.5) * vec2(uRes.x / uRes.y, 1.0)));
  col *= mix(1.0, vig, uVignette);
  col += (hash(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) - 0.5) * uGrain;
  col = mix(col, uFadeColor, uFade);
  gl_FragColor = linearToOutputTexel(vec4(max(col, 0.0), 1.0));
}`;

// A tileable 256x256 noise texture (32 lattice cells across): r, g = smooth value noise, b = 4-octave fbm (octaves wrap
// on the same lattice, so the texture still tiles).
function makeNoiseTexture() {
  const N = 256, C = 32, data = new Uint8Array(N * N * 4);
  let seed = 1337;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const lattice = (period) => Float32Array.from({ length: period * period }, rnd);
  const L = [lattice(C), lattice(C)];
  const sample = (lat, period, x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const g = (i, j) => lat[((j % period + period) % period) * period + ((i % period + period) % period)];
    return (g(xi, yi) * (1 - u) + g(xi + 1, yi) * u) * (1 - v) + (g(xi, yi + 1) * (1 - u) + g(xi + 1, yi + 1) * u) * v;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const cx = x * C / N, cy = y * C / N;
    const r = sample(L[0], C, cx, cy), g = sample(L[1], C, cx + 7.3, cy + 3.1);
    const b = 0.5 * sample(L[1], C, cx, cy) + 0.25 * sample(L[0], C, cx * 2, cy * 2)
      + 0.125 * sample(L[1], C, cx * 4, cy * 4) + 0.125 * sample(L[0], C, cx * 8, cy * 8);
    const i = (y * N + x) * 4;
    data[i] = r * 255; data[i + 1] = g * 255; data[i + 2] = Math.min(255, b * 255); data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------------------------------------
export class World {
  constructor(canvas, { quality = 'medium', base = 'assets/' } = {}) {
    this.base = base;
    this.canvas = canvas;
    this.q = QUALITY[quality] ? quality : 'medium';
    this.Q = QUALITY[this.q];
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false;
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1000);
    r.clippingPlanes = [this.clipPlane];                         // constant 1000 m = nothing cut

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0f0c);
    this.scene.fog = new THREE.FogExp2(0x1b231e, 0.012);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.05, 420);
    this.camera.position.set(0, 3.6, 4.6);
    this._nullCam = new THREE.PerspectiveCamera(1, 1, 0.1, 0.2);
    this._nullCam.position.set(0, -5000, 0);
    this._nullCam.lookAt(0, -6000, 0);
    this._nullCam.updateMatrixWorld();
    this.target = new THREE.Vector3(0, 3.35, 0);

    this.params = { clip: 1000, sketch: 1, paper: 0, shafts: 1, dust: 1, fog: 0.012, exposure: 1.0, ground: 0, mode: 0, water: 0,
      sky: 1, bloom: 0.35, track: 1, loaderLight: 1, vignette: 0.55, fade: 0, dome: 1, poche: 0, fill: 0, sun: 1 };
    this.statueYaw = 0;
    this.statueMode = 'spin';
    this.spinSpeed = 0.55;
    this.ready = { statue: false, world: false };
    this.loaded = {};
    this.totalBytes = 1;
    this._shadowDirty = 0;
    this._lastShadowYaw = 0;
    this._lastShadowT = 0;
    this.fpsSamples = [];
    this.paused = false;

    this.gltf = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('vendor/three/addons/libs/draco/gltf/');
    this.gltf.setDRACOLoader(draco);
    this.texLoader = new THREE.TextureLoader();
    this.T = {};
    this._initLights();
    this._initPost();
    this.resize();
  }

  // ---------------------------------------------------------------- lights
  _initLights() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0x9fb2a4, 0x26301f, 0.4);
    s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe7c4, 5.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.Q.shadow, this.Q.shadow);
    const c = this.sun.shadow.camera;
    c.left = -19.5; c.right = 19.5; c.top = 19.5; c.bottom = -19.5; c.near = 1; c.far = 95;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    s.add(this.sun, this.sun.target);
    // loader rig: key + rim on the statue while she is drawn
    this.key = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.key.position.set(3.5, 6.5, 6.0);
    this.key.target.position.set(0, 3.2, 0);
    this.rim = new THREE.DirectionalLight(0xbfe0d0, 3.4);
    this.rim.position.set(-4, 6, -5);
    this.rim.target.position.set(0, 3.2, 0);
    s.add(this.key, this.key.target, this.rim, this.rim.target);
    // soft fill that travels with the camera: the bounce light Cycles gave the walls for free
    this.fill = new THREE.DirectionalLight(0xdfe6dc, 0.0);
    s.add(this.fill, this.fill.target);
  }

  // ---------------------------------------------------------------- post
  _initPost() {
    const r = this.renderer;
    G.tNoise.value ||= makeNoiseTexture();
    const dt = new THREE.DepthTexture(4, 4);
    dt.type = THREE.UnsignedIntType;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: this.Q.msaa, depthTexture: dt });
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.65, 1.05);
    this.postMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture }, tPaper: { value: null }, tNoise: G.tNoise,
        uRes: { value: new THREE.Vector2(1, 1) }, uTime: G.uTime, uSketch: { value: 1 }, uPaperMode: { value: 0 },
        uNear: { value: this.camera.near }, uFar: { value: this.camera.far }, uVignette: { value: 0.55 }, uGrain: { value: 0.035 },
        uFade: { value: 0 }, uFadeColor: { value: new THREE.Color(0x0b0f0c) }, uCA: { value: 1 }, uPx: { value: 1 }, uGrade: { value: 1 },
      },
      vertexShader: POST_VS, fragmentShader: POST_FS, depthTest: false, depthWrite: false,
    });
    this.postScene = new THREE.Scene();
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat));
    this.texLoader?.load?.('img/paper/paper.jpg', (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; this.postMat.uniforms.tPaper.value = t; });
  }

  resize(force = false) {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth), h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.Q.dpr);
    if (!force && w === this._w && h === this._h && dpr === this.dpr) return false;
    this._w = w; this._h = h;
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    const W = Math.floor(w * dpr), H = Math.floor(h * dpr);
    this.rt.setSize(W, H);
    this.bloom.setSize(Math.max(1, Math.floor(W / 2)), Math.max(1, Math.floor(H / 2)));
    this.postMat.uniforms.uRes.value.set(W, H);
    this.postMat.uniforms.uPx.value = dpr;
    this.camera.aspect = w / h;
    this._applyFov();
    return true;
  }

  _applyFov() {
    // keep the framing on portrait screens: never narrower than the station's horizontal coverage at 16:9
    const a = this.camera.aspect, f = this._fov ?? 36;
    if (a < 1.2) {
      const hf = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(f) / 2) * 1.2);
      this.camera.fov = Math.min(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hf / 2) / a)), 95);
    } else this.camera.fov = f;
    this.camera.updateProjectionMatrix();
  }

  setQuality(q) {
    if (!QUALITY[q] || q === this.q) return;
    this.q = q; this.Q = QUALITY[q];
    this.resize();
    this._applyInstanceFraction();
    if (this.dust) this.dust.geometry.setDrawRange(0, this.Q.dust);
  }

  // ---------------------------------------------------------------- loading
  _progress(name, loaded) {
    this.loaded[name] = loaded;
    const sum = Object.values(this.loaded).reduce((a, b) => a + b, 0);
    this.onProgress?.(Math.min(1, sum / this.totalBytes));
  }

  async _glb(name) {
    const size = this.files?.[name] ?? 1;
    const g = await this.gltf.loadAsync(this.base + name, (e) => this._progress(name, Math.min(e.loaded, size)));
    this._progress(name, size);
    return g;
  }

  _tex(name, srgb = false) {
    const size = this.files?.['tex/' + name] ?? 1;
    return new Promise((res) => {
      this.texLoader.load(this.base + 'tex/' + name, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.flipY = false;                                          // glTF UV convention
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        this._progress('tex/' + name, size);
        res(t);
      }, undefined, () => { this._progress('tex/' + name, size); res(null); });
    });
  }

  async _bin(file) {
    const size = this.files?.[file] ?? 1;
    const resp = await fetch(this.base + file);
    const buf = await resp.arrayBuffer();
    this._progress(file, size);
    return new Float32Array(buf);
  }

  async load() {
    this.meta = await (await fetch(this.base + 'scene.json')).json();
    this.files = this.meta.files;
    this.totalBytes = Object.values(this.files).reduce((a, b) => a + b, 0);
    const m = this.meta;
    this.sunDir = new THREE.Vector3(...m.sun_dir).normalize();
    this.sun.position.copy(this.sunDir).multiplyScalar(40);
    this.sun.target.position.set(0, 0, 0);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), skyMaterial(this.sunDir));
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    // 1. the statue first: she is the loading screen
    const [statueG, marbleBC, marbleN, marbleORH] = await Promise.all([
      this._glb('statue.glb'), this._tex('Marble_BC.jpg', true), this._tex('Marble_N.jpg'), this._tex('Marble_ORH.jpg')]);
    const [mossBC, mossN, mossORH, macro, caus] = await Promise.all([
      this._tex('Moss_BC.jpg', true), this._tex('Moss_N.jpg'), this._tex('Moss_ORH.jpg'), this._tex('Macro.jpg'), this._tex('Caustics.jpg')]);
    Object.assign(G, {});
    G.tMossBC.value = mossBC; G.tMossN.value = mossN; G.tMossORH.value = mossORH; G.tMacro.value = macro; G.tCaustics.value = caus;
    this.T.Marble = [marbleBC, marbleN, marbleORH];
    this.statue = new THREE.Group();
    this.scene.add(this.statue);
    const marble = this._stoneMat('Marble', marbleBC, marbleN, marbleORH, { mossBoost: 0.0, mossTile: 2.4, envI: 0.7, grimeK: 0.3, macroK: 0.25 });
    marble.color = new THREE.Color(1.12, 1.09, 1.03);
    this.bark = new THREE.MeshStandardMaterial({ color: 0x5b4a38, roughness: 0.85 });
    foliagePatch(this.bark, 'bark');
    statueG.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.material = /ivy/i.test(o.name) ? this.bark : marble;
      o.castShadow = true; o.receiveShadow = true;
    });
    this.statue.add(statueG.scene);
    this.renderer.shadowMap.needsUpdate = true;                 // a shadow map must exist before the first lit draw
    this.ready.statue = true;
    this.onStatue?.();

    // 2. the rest of the world
    const texNames = ['StoneCarved', 'StoneAshlar', 'Paving'];
    const texP = Promise.all(texNames.flatMap((n) => [this._tex(n + '_BC.jpg', true), this._tex(n + '_N.jpg'), this._tex(n + '_ORH.jpg')]));
    const extraP = Promise.all([this._tex('Leaf_BC.jpg', true), this._tex('Leaf_N.jpg'), this._tex('Litter_BC.jpg', true), this._tex('Bark_BC.jpg', true),
      this._tex('Water_N.jpg'), this._tex('Foam.jpg', true), this._tex('Detail_N.jpg')]);
    const binsP = Promise.all(m.instances.map((e) => this._bin(e.file).then((a) => [e, a])));
    const [worldG, libG, texs, extras, bins] = await Promise.all([this._glb('world.glb'), this._glb('library.glb'), texP, extraP, binsP]);

    const mats = {}, domeMats = {};
    texNames.forEach((n, i) => {
      mats[n] = this._stoneMat(n, texs[i * 3], texs[i * 3 + 1], texs[i * 3 + 2], { envI: 0.6 });
      domeMats[n] = this._stoneMat(n, texs[i * 3], texs[i * 3 + 1], texs[i * 3 + 2], { envI: 0.6, dome: true });
    });
    const [leafBC, leafN, litterBC, barkBC, waterN, foam] = extras;
    this.bark.map = barkBC; this.bark.color.set(0xb8a890); this.bark.needsUpdate = true;
    const byName = { M_Stone: mats.StoneCarved, M_Ashlar: mats.StoneAshlar, M_Paving: mats.Paving, M_Bark: this.bark };
    const byNameDome = { M_Stone: domeMats.StoneCarved, M_Ashlar: domeMats.StoneAshlar, M_Paving: domeMats.Paving, M_Bark: this.bark };
    this.world = worldG.scene;
    this.world.traverse((o) => {
      if (!o.isMesh) return;
      const mname = o.material?.name || '';
      let isDome = false;
      for (let p = o; p; p = p.parent) if (/^dome/i.test(p.name || '')) isDome = true;
      o.material = (isDome ? byNameDome : byName)[mname] || mats.StoneCarved;
      if (isDome) (this.domeMeshes ||= []).push(o);
      o.castShadow = true; o.receiveShadow = true;
    });
    this.scene.add(this.world);

    this._buildInstances(libG, bins, { leafBC, leafN, litterBC });
    this._buildWater(waterN, foam);
    this._buildShafts();
    this._buildSign();
    this._buildGround();
    this.ready.world = true;
    this._applyInstanceFraction();
    await this._warmup();
    this.onWorld?.();
  }

  _stoneMat(key, bc, n, orh, { mossBoost = 0, mossTile = 1.7, envI = 0.6, grimeK = 1, macroK = 1, dome = false } = {}) {
    const m = new THREE.MeshStandardMaterial({ map: bc, normalMap: n, roughnessMap: orh, aoMap: orh, aoMapIntensity: 0.9, roughness: 1.0,
      metalness: 0.0, side: THREE.DoubleSide, envMapIntensity: envI });
    stonePatch(m, key, { mossBoost, mossTile, grimeK, macroK, dome });
    return m;
  }

  // ---------------------------------------------------------------- foliage
  _buildInstances(libG, bins, { leafBC, leafN, litterBC }) {
    const lib = {};
    libG.scene.traverse((o) => { if (o.isMesh) lib[o.name] = o; });
    const leafMat = new THREE.MeshStandardMaterial({ map: leafBC, normalMap: leafN, side: THREE.DoubleSide, roughness: 0.52, envMapIntensity: 0.5 });
    foliagePatch(leafMat, 'leaf', { translucent: true });
    const litterMat = new THREE.MeshStandardMaterial({ map: litterBC, side: THREE.DoubleSide, roughness: 0.75, envMapIntensity: 0.4 });
    foliagePatch(litterMat, 'litter');
    const vcolMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.62, envMapIntensity: 0.4 });
    foliagePatch(vcolMat, 'vcol', { translucent: true });
    const mossMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, envMapIntensity: 0.3 });
    foliagePatch(mossMat, 'moss', { triplanar: true });
    const pebbleMat = new THREE.MeshStandardMaterial({ color: 0x8c877c, roughness: 0.78, envMapIntensity: 0.4 });
    foliagePatch(pebbleMat, 'pebble');
    const matFor = (mesh) => mesh.startsWith('leaf') ? leafMat : mesh.startsWith('litter') ? litterMat
      : mesh.startsWith('moss') ? mossMat : mesh.startsWith('pebble') ? pebbleMat : vcolMat;
    const tintFor = (mesh, t) => {
      const c = new THREE.Color();
      if (mesh.startsWith('leaf')) c.setRGB(0.78 + 0.36 * t, 0.84 + 0.26 * t, 0.7 + 0.2 * t);
      else if (mesh.startsWith('moss')) c.setRGB(0.7 + 0.4 * t, 0.78 + 0.3 * t, 0.55 + 0.2 * t);
      else if (mesh.startsWith('pebble')) c.setRGB(0.7 + 0.45 * t, 0.7 + 0.42 * t, 0.68 + 0.4 * t);
      else c.setRGB(0.85 + 0.25 * t, 0.85 + 0.25 * t, 0.85 + 0.2 * t);
      return c;
    };
    // merge sets that share a library mesh (ivy3d + ivyground3d, fern3d + wallfern3d)
    const groups = {};
    for (const [e, arr] of bins) (groups[e.mesh] ||= []).push(arr);
    this.instanced = [];
    this.foliage = new THREE.Group();
    this.scene.add(this.foliage);
    const shadowFor = (mesh) => mesh.startsWith('fern') || mesh.startsWith('grass') || (this.q === 'high' && mesh.startsWith('leaf'));
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), qt = new THREE.Quaternion(), sc = new THREE.Vector3();
    for (const [mesh, arrs] of Object.entries(groups)) {
      const src = lib[mesh];
      if (!src) { console.warn('missing library mesh', mesh); continue; }
      const n = arrs.reduce((a, b) => a + b.length / 11, 0);
      const all = new Float32Array(n * 11);
      let off = 0;
      for (const a of arrs) { all.set(a, off); off += a.length; }
      // the statue's own leaves turn with her
      const onStatue = [], world = [];
      for (let i = 0; i < n; i++) {
        const x = all[i * 11], y = all[i * 11 + 1], z = all[i * 11 + 2];
        ((x * x + z * z < 0.95 * 0.95 && y > 1.95) ? onStatue : world).push(i);
      }
      // the ring is cut into eight wedges so the ones behind the camera are culled (one mesh for the whole ring was
      // always "in view"); the shuffled order is kept inside each part, so a prefix stays a uniform sample
      const SECT = 8, wedges = Array.from({ length: SECT }, () => []);
      for (const i of world) {
        const a = Math.atan2(all[i * 11 + 2], all[i * 11]) + Math.PI;
        wedges[Math.min(SECT - 1, Math.floor(a / (2 * Math.PI) * SECT))].push(i);
      }
      for (const [ids, parent] of [...wedges.map((w) => [w, this.foliage]), [onStatue, this.statue]]) {
        if (!ids.length) continue;
        const im = new THREE.InstancedMesh(src.geometry, matFor(mesh), ids.length);
        ids.forEach((i, k) => {
          const b = i * 11;
          p.set(all[b], all[b + 1], all[b + 2]);
          qt.set(all[b + 3], all[b + 4], all[b + 5], all[b + 6]);
          sc.set(all[b + 7], all[b + 8], all[b + 9]);
          m4.compose(p, qt, sc);
          im.setMatrixAt(k, m4);
          im.setColorAt(k, tintFor(mesh, all[b + 10]));
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.castShadow = shadowFor(mesh);
        im.receiveShadow = true;
        im.userData.total = ids.length;
        im.computeBoundingSphere();
        parent.add(im);
        this.instanced.push(im);
      }
    }
  }

  _applyInstanceFraction() {
    if (!this.instanced) return;
    for (const im of this.instanced) im.count = Math.max(1, Math.floor(im.userData.total * this.Q.frac));
    if (this.shadowMaps) this._bakeShadows();
  }

  // ---------------------------------------------------------------- water
  _buildWater(waterN, foam) {
    const geo = new THREE.CircleGeometry(12.95, 180);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a4a2c, roughness: 0.045, metalness: 0.0, transparent: true, opacity: 0.9,
      normalMap: waterN, normalScale: new THREE.Vector2(0.28, 0.28), envMapIntensity: 1.7 });
    // obstacles that break the surface: pedestal (square), 12 piers, rubble heaps
    const obst = [];
    for (let i = 0; i < 12; i++) { const a = THREE.MathUtils.degToRad(i * 30); obst.push(new THREE.Vector3(10.05 * Math.cos(a), -10.05 * Math.sin(a), 0.95)); }
    for (const [x, y, r] of [[-4.36, 6.23, 0.7], [-8.37, -0.73, 0.7], [1.49, 8.47, 0.7], [-2.74, -7.52, 0.7], [7.53, 2.02, 0.7], [4.96, -3.88, 0.7],
      [1.67, -6.7, 0.7], [1.29, 2.59, 0.5], [-0.65, -2.56, 0.5], [2.92, -2.28, 0.5], [-1.73, 2.07, 0.5], [2.33, -3.11, 0.5]]) obst.push(new THREE.Vector3(x, -y, r * 0.55));
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, G);
      sh.uniforms.tFoam = { value: foam };
      sh.uniforms.uObst = { value: obst };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uMode; uniform float uClipY; uniform sampler2D tFoam; uniform vec3 uObst[24];
varying vec3 vWPos;
${NOISE}`)
        .replace('#include <map_fragment>', `
float dmin = max(abs(vWPos.x), abs(vWPos.z)) - 1.58;
for (int i = 0; i < 24; i++) dmin = min(dmin, length(vWPos.xz - uObst[i].xy) - uObst[i].z);
float fn = texture2D(tFoam, vWPos.xz * 0.16 + vec2(uTime * 0.004, 0.0)).r;
float foamAmt = smoothstep(0.42, 0.0, dmin + (fn - 0.5) * 0.35) * smoothstep(0.35, 0.75, fn + 0.2);
vec3 V = normalize(cameraPosition - vWPos);
float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
diffuseColor.rgb = mix(diffuseColor.rgb * (0.7 + 0.4 * vnoise(vWPos.xz * 0.35 + uTime * 0.02)), vec3(0.78, 0.82, 0.76), foamAmt * 0.75);
diffuseColor.a = mix(0.86, 0.99, max(fres, foamAmt));
if (uMode > 0.5 && uMode < 1.5) diffuseColor.rgb = vec3(0.45, 0.52, 0.55);`)
        .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(roughness, 0.6, foamAmt);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(0.016, 0.062, 0.03) * (1.0 - foamAmt) * (0.55 + 0.45 * (1.0 - fres)) * step(uMode, 0.5);`)
        .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `
vec2 wuv = vWPos.xz * 0.11;
vec3 n1 = texture2D(normalMap, wuv + vec2(uTime * 0.011, uTime * 0.006)).xyz * 2.0 - 1.0;
vec3 n2 = texture2D(normalMap, wuv * 2.1 + vec2(-uTime * 0.008, uTime * 0.013)).xyz * 2.0 - 1.0;
vec3 mapN = normalize(vec3(n1.xy + n2.xy, n1.z * n2.z));`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
if (vWPos.y > uClipY) discard;`);
    };
    mat.customProgramCacheKey = () => 'water';
    this.water = new THREE.Mesh(geo, mat);
    this.water.receiveShadow = true;
    this.water.renderOrder = 2;
    this.scene.add(this.water);
  }

  // ---------------------------------------------------------------- light shafts + dust
  _buildShafts() {
    const dir = this.sunDir.clone().negate();
    const up = new THREE.Vector3(0, 1, 0);
    this.shafts = new THREE.Group();
    const mat = this.shaftMat = shaftMaterial();
    mat.uniforms.uAxis.value.copy(dir);
    const segs = [];
    for (const [x, y, z, r] of this.meta.holes) {
      const s = new THREE.Vector3(x, y, z);
      let t = (y - 0.0) / -dir.y;                                // reach the water
      // stop at the inner wall (r ~ 9.3) if it comes first
      const a = dir.x * dir.x + dir.z * dir.z, b = 2 * (s.x * dir.x + s.z * dir.z), c = s.x * s.x + s.z * s.z - 9.3 * 9.3;
      const disc = b * b - 4 * a * c;
      if (disc > 0 && c < 0) { const tw = (-b + Math.sqrt(disc)) / (2 * a); if (tw > 0) t = Math.min(t, tw); }
      if (t < 1) continue;
      const geo = new THREE.CylinderGeometry(r * 0.9, r * 1.08, t, 28, 1, true);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.quaternion.setFromUnitVectors(up, dir.clone().negate());
      mesh.position.copy(s).addScaledVector(dir, t / 2);
      mesh.renderOrder = 5;
      this.shafts.add(mesh);
      segs.push([s, t, r]);
    }
    this.scene.add(this.shafts);
    // dust: mostly inside the shafts, some in the air
    const N = QUALITY.high.dust;
    const pos = new Float32Array(N * 3), rnd = new Float32Array(N), lit = new Float32Array(N);
    const tmp = new THREE.Vector3(), side = new THREE.Vector3(), side2 = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      rnd[i] = Math.random();
      if (i % 5 !== 0 && segs.length) {
        const [s, t, r] = segs[(Math.random() * segs.length) | 0];
        side.crossVectors(dir, up).normalize(); side2.crossVectors(dir, side).normalize();
        const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * r * 0.95;
        tmp.copy(s).addScaledVector(dir, (0.12 + 0.86 * Math.random()) * t).addScaledVector(side, Math.cos(ang) * rr).addScaledVector(side2, Math.sin(ang) * rr);
        lit[i] = 1;
      } else {
        const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * 8.5;
        tmp.set(Math.cos(ang) * rr, 0.3 + Math.random() * 12, Math.sin(ang) * rr);
        lit[i] = 0.22;
      }
      pos.set([tmp.x, tmp.y, tmp.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
    g.setAttribute('aLit', new THREE.BufferAttribute(lit, 1));
    g.setDrawRange(0, this.Q.dust);
    this.dustMat = dustMaterial();
    this.dust = new THREE.Points(g, this.dustMat);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 6;
    this.scene.add(this.dust);
  }

  // ---------------------------------------------------------------- NO ENTRY: two planks and a board across the door bay
  _buildSign() {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 400;
    const x = c.getContext('2d');
    const wood = x.createLinearGradient(0, 0, 0, 400);
    wood.addColorStop(0, '#5a4430'); wood.addColorStop(0.5, '#4a3726'); wood.addColorStop(1, '#3b2b1d');
    x.fillStyle = wood; x.fillRect(0, 0, 1024, 400);
    for (let i = 0; i < 70; i++) {
      x.strokeStyle = `rgba(${20 + Math.random() * 30},${12 + Math.random() * 20},6,${0.15 + Math.random() * 0.25})`;
      x.lineWidth = 1 + Math.random() * 3;
      x.beginPath();
      const y0 = Math.random() * 400;
      x.moveTo(0, y0);
      for (let k = 1; k <= 8; k++) x.lineTo(k * 128, y0 + Math.sin(k * 0.9 + i) * 6 + (Math.random() - 0.5) * 6);
      x.stroke();
    }
    x.fillStyle = 'rgba(214, 206, 186, 0.92)';
    x.font = '700 168px "Cinzel", serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.save(); x.translate(512, 170); x.rotate(-0.025);
    x.fillText('NO ENTRY', 0, 0);
    x.restore();
    x.fillStyle = 'rgba(168, 40, 32, 0.95)';
    x.font = '400 64px "Reenie Beanie", cursive';
    x.fillText('the water rises for every one of you', 512, 318);
    x.fillStyle = '#1b130c';
    for (const [nx, ny] of [[40, 40], [984, 40], [40, 360], [984, 360]]) { x.beginPath(); x.arc(nx, ny, 9, 0, 7); x.fill(); }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.signTex = tex;
    // the inward face: the keepers' tally, one scratch per visitor
    const c2 = document.createElement('canvas');
    c2.width = 1024; c2.height = 400;
    const y2 = c2.getContext('2d');
    y2.drawImage(c, 0, 0);
    y2.fillStyle = 'rgba(40,28,18,0.9)'; y2.fillRect(0, 0, 1024, 400);
    for (let i = 0; i < 60; i++) {
      y2.strokeStyle = `rgba(${20 + Math.random() * 30},${12 + Math.random() * 20},6,${0.2 + Math.random() * 0.3})`;
      y2.lineWidth = 1 + Math.random() * 3; y2.beginPath(); const yy = Math.random() * 400; y2.moveTo(0, yy); y2.lineTo(1024, yy + (Math.random() - 0.5) * 10); y2.stroke();
    }
    y2.strokeStyle = 'rgba(222,214,196,0.8)'; y2.lineCap = 'round';
    let gx = 60, gy = 70;
    for (let gI = 0; gI < 26; gI++) {
      for (let k = 0; k < 4; k++) { y2.lineWidth = 3 + Math.random() * 2; y2.beginPath(); y2.moveTo(gx + k * 14 + Math.random() * 3, gy); y2.lineTo(gx + k * 14 + Math.random() * 4 - 2, gy + 58 + Math.random() * 6); y2.stroke(); }
      y2.beginPath(); y2.moveTo(gx - 8, gy + 50); y2.lineTo(gx + 58, gy + 8); y2.stroke();
      gx += 92; if (gx > 960) { gx = 60; gy += 96; }
    }
    y2.fillStyle = 'rgba(222,214,196,0.85)'; y2.font = '400 46px "Reenie Beanie", cursive'; y2.textAlign = 'right';
    y2.fillText('keepers\' count - do not add to it', 990, 380);
    const tex2 = new THREE.CanvasTexture(c2);
    tex2.colorSpace = THREE.SRGBColorSpace;
    const plankMat = new THREE.MeshStandardMaterial({ color: 0x4d3a28, roughness: 0.9 });
    foliagePatch(plankMat, 'plank');
    const boardMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
    foliagePatch(boardMat, 'board');
    const tallyMat = new THREE.MeshStandardMaterial({ map: tex2, roughness: 0.9 });
    foliagePatch(tallyMat, 'tally');
    const g = this.sign = new THREE.Group();
    const phi = THREE.MathUtils.degToRad(257);
    const R = 9.18;
    g.position.set(R * Math.cos(phi), 2.05, -R * Math.sin(phi));
    g.lookAt(0, 2.05, 0);                                       // +z points into the rotunda
    for (const s of [1, -1]) {
      const pl = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.3, 0.06), plankMat);
      pl.rotation.z = s * 0.4;
      pl.position.z = s * 0.035;
      pl.castShadow = true; pl.receiveShadow = true;
      g.add(pl);
    }
    // the painted face looks out, at whoever is about to come in; the tally faces her
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.66, 0.05), [plankMat, plankMat, plankMat, plankMat, tallyMat, boardMat]);
    board.position.set(0, 0.05, -0.1);
    board.rotation.z = -0.035;
    board.castShadow = true; board.receiveShadow = true;
    g.add(board);
    this.signAnchor = g.position.clone();
    this.scene.add(g);
  }

  // ---------------------------------------------------------------- the drawing the model stands on (seen from outside)
  _buildGround() {
    const S = 2048, c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    const k = S / 80;                                           // 80 m across
    const P = (m) => S / 2 + m * k;
    x.clearRect(0, 0, S, S);
    x.strokeStyle = 'rgba(233,228,214,0.55)';
    x.lineWidth = 2;
    const circ = (r, dash = []) => { x.setLineDash(dash); x.beginPath(); x.arc(S / 2, S / 2, r * k, 0, Math.PI * 2); x.stroke(); };
    circ(13.6); circ(16, [10, 12]); circ(22, [3, 14]); circ(30, [3, 22]);
    x.setLineDash([]);
    for (let i = 0; i < 12; i++) {
      const a = (i * 30) * Math.PI / 180;
      x.beginPath(); x.moveTo(P(14 * Math.cos(a)), P(-14 * Math.sin(a))); x.lineTo(P(23.5 * Math.cos(a)), P(-23.5 * Math.sin(a))); x.stroke();
      const b = (i * 30 + 15) * Math.PI / 180;
      x.fillStyle = 'rgba(233,228,214,0.6)';
      x.font = `${Math.round(k * 1.1)}px "Cinzel", serif`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][i], P(18.6 * Math.cos(b)), P(-18.6 * Math.sin(b)));
    }
    x.strokeStyle = 'rgba(158,43,37,0.8)'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(P(-34), P(0)); x.lineTo(P(34), P(0)); x.moveTo(P(0), P(-34)); x.lineTo(P(0), P(34)); x.setLineDash([22, 10, 4, 10]); x.stroke();
    x.setLineDash([]);
    x.fillStyle = 'rgba(233,228,214,0.55)';
    x.font = `${Math.round(k * 1.25)}px "Caveat", cursive`;
    x.textAlign = 'left';
    x.fillText('the ring of the Eye  -  12 bays, r 9.6 m to the piers', P(-31), P(-31));
    x.fillText('door bay (IX) - NO ENTRY', P(-9), P(30.5));
    x.fillText('A', P(34.5), P(0)); x.fillText('A', P(-35.5), P(0));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), mat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -1.14;
    this.ground.renderOrder = -1;
    this.scene.add(this.ground);
  }

  // ---------------------------------------------------------------- warm-up: compile, bake env + shadows once
  async _warmup() {
    const r = this.renderer;
    this.clipPlane.constant = 1000;
    // environment from the room itself (one bounce of "GI"), sky bright through the sixteen eyes
    const cubeRT = new THREE.WebGLCubeRenderTarget(this.q === 'low' ? 64 : 128, { type: THREE.HalfFloatType });
    const cubeCam = new THREE.CubeCamera(0.1, 300, cubeRT);
    cubeCam.position.set(0, 6.4, 0);
    const fogWas = this.scene.fog;
    this.foliage.visible = false; this.shafts.visible = false; this.dust.visible = false; this.ground.visible = false;
    this.sky.material.uniforms.uI.value = 1;
    this.sky.visible = true;
    this.renderer.shadowMap.needsUpdate = true;
    cubeCam.update(r, this.scene);
    const pmrem = new THREE.PMREMGenerator(r);
    this.envRT = pmrem.fromCubemap(cubeRT.texture);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 1.0;
    pmrem.dispose(); cubeRT.dispose();
    this.foliage.visible = true; this.shafts.visible = true; this.dust.visible = true; this.ground.visible = true;
    this.scene.fog = fogWas;
    this._bakeShadows();
    if (r.compileAsync) { try { await r.compileAsync(this.scene, this.camera); } catch (e) { /* not fatal */ } }
  }

  // Two static shadow maps, rendered once: with the dome casting (the room as it is) and without (the roof lifted).
  // Switching between them is a pointer swap, so no frame ever pays for a shadow pass after loading.
  _bakeShadows() {
    const r = this.renderer, sun = this.sun;
    const pass = () => { r.shadowMap.needsUpdate = true; r.setRenderTarget(this.rt); r.render(this.scene, this._nullCam); r.shadowMap.needsUpdate = false; };
    const old = new Set([sun.shadow.map, this.shadowMaps?.dome, this.shadowMaps?.open].filter(Boolean));
    sun.shadow.map = null;
    (this.domeMeshes || []).forEach((m) => { m.castShadow = true; });
    pass();
    const dome = sun.shadow.map;
    sun.shadow.map = null;
    (this.domeMeshes || []).forEach((m) => { m.castShadow = false; });
    pass();
    const open = sun.shadow.map;
    (this.domeMeshes || []).forEach((m) => { m.castShadow = true; });
    old.forEach((m) => { m.depthTexture?.dispose(); m.dispose(); });
    this.shadowMaps = { dome, open };
    sun.shadow.map = this.params.dome > 0.5 ? dome : open;
  }

  // ---------------------------------------------------------------- per-frame
  setView(pos, target, fov) {
    this.camera.position.copy(pos);
    this.target.copy(target);
    this.camera.lookAt(target);
    if (Math.abs((this._fov ?? 0) - fov) > 1e-3) { this._fov = fov; this._applyFov(); }
  }

  setParams(p) { Object.assign(this.params, p); }

  project(v, out) {
    out.copy(v).project(this.camera);
    return out;
  }

  _updateStatue(dt) {
    if (!this.statue) return;
    if (this.statueMode === 'spin') {
      this.statueYaw += dt * this.spinSpeed;
    } else if (this.statueMode !== 'hold') {
      const c = this.camera.position;
      const want = Math.atan2(c.x, c.z);
      let d = want - this.statueYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const near = THREE.MathUtils.clamp(1.6 - this.camera.position.length() / 12, 0.35, 1.4);
      const rate = this.statueMode === 'face' ? 1.8 : 0.42 * near * this.params.track;
      const step = Math.sign(d) * Math.min(Math.abs(d), rate * dt * (0.25 + Math.min(1, Math.abs(d) * 1.6)));
      this.statueYaw += step;
    }
    this.statue.rotation.y = this.statueYaw;
    // (her shadow stays as baked: re-rendering every caster while she turns caused periodic hitches)
  }

  render(t, dt) {
    G.uTime.value = t;
    this._updateStatue(dt);
    const P = this.params, r = this.renderer;
    this.scene.fog.density = P.fog;
    r.toneMappingExposure = P.exposure;
    G.uClipY.value = P.clip;
    G.uDomeCut.value = THREE.MathUtils.clamp(1 - P.dome, 0, 1);
    G.uPocheK.value = THREE.MathUtils.clamp(P.poche, 0, 1);
    // when the lid is lifted the light floods in: the dome stops casting its shadow
    if (this.shadowMaps) {
      const want = P.dome > 0.5 ? this.shadowMaps.dome : this.shadowMaps.open;
      if (this.sun.shadow.map !== want) this.sun.shadow.map = want;
    }
    this.clipPlane.constant = Math.min(P.clip, 1000);
    G.uMode.value = Math.round(P.mode);
    G.uWaterY.value = P.water;
    if (this.water) this.water.position.y = P.water;
    if (this.shaftMat) { this.shaftMat.uniforms.uIntensity.value = P.shafts; this.shafts.visible = P.shafts > 0.01; }
    if (this.dustMat) { this.dustMat.uniforms.uIntensity.value = P.dust; this.dustMat.uniforms.uPx.value = this.dpr; this.dust.visible = P.dust > 0.01; }
    if (this.ground) { this.ground.material.opacity = P.ground; this.ground.visible = P.ground > 0.01; }
    if (this.sky) { this.sky.material.uniforms.uI.value = P.sky; this.sky.visible = P.sky > 0.01; }
    this.key.intensity = 2.6 * P.loaderLight; this.rim.intensity = 3.4 * P.loaderLight;
    this.fill.intensity = this.ready.world ? P.fill : 0;
    if (this.fill.intensity > 0.001) {
      const c = this.camera.position;
      this.fill.position.set(c.x, c.y + 2.5, c.z);
      this.fill.target.position.copy(this.target);
      this.fill.target.updateMatrixWorld();
    }
    this.sun.intensity = 5.2 * (this.ready.world ? 1 : 0.0) * (P.sun ?? 1);
    this.hemi.intensity = this.ready.world ? 0.38 : 0.15;
    const u = this.postMat.uniforms;
    u.uSketch.value = P.sketch; u.uPaperMode.value = P.paper; u.uVignette.value = P.vignette; u.uFade.value = P.fade;
    if (this.paused) return;

    // (three.js never clips the shadow pass, so the cut model keeps the lighting of the closed building)
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.camera);
    if (this.Q.bloom && P.bloom > 0.01) {
      this.bloom.strength = P.bloom;
      this.bloom.render(r, null, this.rt, dt, false);
    }
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCam);
  }
}
