// Camera stations and the scroll -> camera mapping.
// Every world section in the page names a station; the camera holds there while the section fills the screen and
// travels (through optional waypoints) while the next one scrolls in. Coordinates: three.js frame (Y up), metres.
import * as THREE from 'three';

const D = { clip: 1000, sketch: 0, paper: 0, shafts: 1, dust: 1, fog: 0.008, exposure: 1.08, ground: 0, sky: 1, mode: 0, water: 0,
  track: 1, loaderLight: 0, bloom: 0.38, vignette: 0.55, sway: 0, dome: 1, poche: 0, fill: 0.35 };

const door = (r, y) => { const a = THREE.MathUtils.degToRad(257); return [r * Math.cos(a), y, -r * Math.sin(a)]; };

export const STATIONS = {
  loader: { pos: [0.0, 3.62, 4.9], target: [0, 3.3, 0], fov: 37, sketch: 1, shafts: 0, dust: 0, fog: 0, sky: 0, exposure: 1.0, loaderLight: 1, bloom: 0.15, vignette: 0.8 },
  reveal: { pos: [0.35, 3.75, 4.6], target: [0, 3.55, 0], fov: 35, loaderLight: 0.3, fill: 0.12, shafts: 1.3, fog: 0.006, exposure: 1.0, vignette: 0.7, drift: [[-0.25, -0.05, 0.25], [0, 0, 0]] },
  rise: { pos: [1.4, 12.5, 3.0], target: [0, 3.0, 0], fov: 46, loaderLight: 0.1 },
  oculus: { pos: [0.7, 27, 1.1], target: [0, 2.0, 0], fov: 44, sky: 0.4 },
  hero: { pos: [17.5, 43, 22.5], target: [-6.4, 1.0, 2.6], fov: 34, dome: 0, sky: 0, ground: 0.9, fog: 0.002, shafts: 0, dust: 0, exposure: 1.02, bloom: 0.22, sway: 10, drift: [[0, 0, 0], [-2, -3, -2.5]] },
  plan: { pos: [-12.99, 66, 1.0], target: [-13.0, 0, 0], fov: 30, clip: 2.6, poche: 1, dome: 0, sky: 0, ground: 0.8, fog: 0.0, shafts: 0, dust: 0, sketch: 1, paper: 1, exposure: 1.9, bloom: 0.0, vignette: 0.2, drift: [[0, 0, 0], [0, -6, 0]] },
  descend: { pos: [4.2, 13.0, 5.0], target: [-1.5, 4.0, -2.0], fov: 46, dome: 0, sky: 1, shafts: 0.2 },
  bays: { pos: [-2.2, 1.9, 4.6], target: [8.2, 5.2, 1.4], fov: 52, fill: 0.6, exposure: 1.2, drift: [[0, 0, 0], [0.5, 0.2, -0.6]] },
  dome: { pos: [3.83, 0.9, 3.21], target: [-1.73, 17.0, -1.0], fov: 62, shafts: 0.95, dust: 1.4, bloom: 0.32, exposure: 1.0, drift: [[0, 0, 0], [-0.5, 0.2, 0.6]] },
  statue: { pos: [-0.76, 4.4, 4.33], target: [0.75, 3.7, 0.15], fov: 31, shafts: 1.0, fill: 0.7, drift: [[0, 0, 0], [0.45, -0.12, 0.2]] },
  water: { pos: [5.4, 1.5, 5.9], target: [0.2, 1.9, 0.1], fov: 46, fill: 0.5, drift: [[0, 0, 0], [-0.7, 0.05, -0.6]] },
  ivy: { pos: [2.6, 4.7, 5.0], target: [4.6, 5.0, 7.97], fov: 40, fill: 1.5, exposure: 1.2, drift: [[0, 0, 0], [0.5, 0.3, 0.2]] },
  door: { pos: door(12.05, 2.9), target: [0, 2.85, 0], fov: 40, fill: 0.55, drift: [[0, 0, 0], [0.15, 0.05, -0.45]] },
  breakdown: { pos: [5.5, 7.4, 5.3], target: [0, 3.0, 0], fov: 50, sway: 14, fill: 0.45, modeScrub: [1, 2, 3, 0] },
  oculusIn: { pos: [0.8, 13.0, 0.9], target: [0.4, 30, 0.3], fov: 62 },
  oculusOut: { pos: [0.5, 31, 0.8], target: [0, 0, 0.4], fov: 52, sky: 0.3 },
  finale: { pos: [-54, 27, -31], target: [2.6, 8.0, -5.6], fov: 31, clip: 1000, sky: 0, ground: 0.9, fog: 0.0028, shafts: 0, dust: 0, exposure: 1.05, bloom: 0.25, water: 0.12, sway: 8, fill: 0.25 },
};
// waypoints used on the way INTO a station
const VIA = { hero: ['rise', 'oculus'], bays: ['descend'], finale: ['oculusIn', 'oculusOut'] };
const PARAMS = Object.keys(D);

function full(name) {
  const s = STATIONS[name];
  const o = { name, ...D, ...s };
  o.pos = new THREE.Vector3(...s.pos);
  o.target = new THREE.Vector3(...s.target);
  o.d0 = new THREE.Vector3(...(s.drift?.[0] ?? [0, 0, 0]));
  o.d1 = new THREE.Vector3(...(s.drift?.[1] ?? [0, 0, 0]));
  return o;
}

const smooth = (t) => t * t * (3 - 2 * t);

export class Tour {
  constructor(sections) {
    this.sections = sections;          // [{el, station}]
    this.keys = [];
    this.build();
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.mouse = new THREE.Vector2();
    this.mouseS = new THREE.Vector2();
  }

  build() {
    const vh = window.innerHeight;
    const keys = [];
    for (const { el, station } of this.sections) {
      const top = el.offsetTop, h = el.offsetHeight;
      const arrive = top, leave = Math.max(top, top + h - vh);
      const via = VIA[station] || [];
      if (keys.length && via.length) {
        const prev = keys[keys.length - 1].y;
        via.forEach((v, i) => keys.push({ y: prev + (arrive - prev) * (i + 1) / (via.length + 1), st: full(v), via: true }));
      }
      const st = full(station);
      keys.push({ y: arrive, st, hold: 0 });
      keys.push({ y: leave + 0.5, st, hold: 1 });
    }
    this.keys = keys;
  }

  _keyPos(k, which) {
    const st = k.st;
    const p = (which === 'pos' ? st.pos : st.target).clone();
    if (which === 'pos' && !k.via) p.add(k.hold ? st.d1 : st.d0);
    return p;
  }

  // Hermite: zero tangents at stations (ease in / out), Catmull-Rom tangents through waypoints
  _tangent(i, which) {
    const k = this.keys[i];
    if (!k.via) return new THREE.Vector3();
    const a = this._keyPos(this.keys[Math.max(0, i - 1)], which), b = this._keyPos(this.keys[Math.min(this.keys.length - 1, i + 1)], which);
    return b.sub(a).multiplyScalar(0.5);
  }

  sample(y, time) {
    const K = this.keys;
    if (!K.length) return null;
    let i = 0;
    while (i < K.length - 2 && y > K[i + 1].y) i++;
    const a = K[i], b = K[Math.min(i + 1, K.length - 1)];
    let u = b.y > a.y ? THREE.MathUtils.clamp((y - a.y) / (b.y - a.y), 0, 1) : 1;
    if (y <= K[0].y) u = 0;
    const holding = a.st === b.st && !a.via && !b.via;
    const e = holding ? u : (a.via || b.via ? u : smooth(u));
    const herm = (which) => {
      const p0 = this._keyPos(a, which), p1 = this._keyPos(b, which);
      if (holding) return p0.lerp(p1, smooth(u));
      const m0 = this._tangent(i, which), m1 = this._tangent(i + 1, which);
      const t = u;                                             // zero station tangents already ease in/out
      const t2 = t * t, t3 = t2 * t;
      return p0.multiplyScalar(2 * t3 - 3 * t2 + 1).add(m0.multiplyScalar(t3 - 2 * t2 + t))
        .add(p1.multiplyScalar(-2 * t3 + 3 * t2)).add(m1.multiplyScalar(t3 - t2));
    };
    const pos = herm('pos'), target = herm('target');
    const out = {};
    for (const k of PARAMS) {
      const va = a.st[k], vb = b.st[k];
      if (k === 'clip') {
        const la = Math.log(Math.max(va, 0.1)), lb = Math.log(Math.max(vb, 0.1));
        out[k] = Math.exp(la + (lb - la) * e);
      } else out[k] = va + (vb - va) * e;
    }
    out.fov = a.st.fov + (b.st.fov - a.st.fov) * e;
    // breakdown: the hold scrubs clay -> masks -> light -> final
    if (holding && a.st.modeScrub) out.mode = a.st.modeScrub[Math.min(a.st.modeScrub.length - 1, Math.floor(u * a.st.modeScrub.length))];
    // gentle sway around the target while holding, and a little mouse parallax
    const sway = out.sway * Math.sin(time * 0.17) * Math.PI / 180;
    if (Math.abs(sway) > 1e-5) {
      const v = pos.clone().sub(target);
      v.applyAxisAngle(new THREE.Vector3(0, 1, 0), sway);
      pos.copy(target).add(v);
    }
    this.mouseS.lerp(this.mouse, 0.05);
    const dist = pos.distanceTo(target);
    const right = new THREE.Vector3().subVectors(target, pos).cross(new THREE.Vector3(0, 1, 0)).normalize();
    target.addScaledVector(right, this.mouseS.x * 0.012 * dist).add(new THREE.Vector3(0, -this.mouseS.y * 0.008 * dist, 0));
    out.station = (u < 0.5 ? a : b).st.name;
    // how far along the whole journey between two stations (waypoints included): 0 at a station, 1 mid-way
    let t = 0;
    if (!holding) {
      let p = i; while (p > 0 && K[p].via) p--;
      let n = i + 1; while (n < K.length - 1 && K[n].via) n++;
      const span = K[n].y - K[p].y;
      if (span > 1) t = Math.sin(Math.PI * THREE.MathUtils.clamp((y - K[p].y) / span, 0, 1));
    }
    out.transit = t;
    out.pos = pos; out.target = target; out.u = u; out.holding = holding;
    return out;
  }
}
