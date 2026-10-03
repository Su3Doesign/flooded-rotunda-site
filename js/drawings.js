// Hand-drafted SVG sheets (plan + bay section). Lines are drawn in on scroll by main.js.
const NS = 'http://www.w3.org/2000/svg';
const DEG = Math.PI / 180;

function el(parent, tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  parent.appendChild(e);
  return e;
}

// a slightly unsteady line: draftsman's hand, not a ruler
function wob(points, amp = 0.06, seed = 1) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${(x + rnd() * amp).toFixed(3)} ${(y + rnd() * amp).toFixed(3)}`).join(' ');
}
const arcPts = (cx, cy, r, a0, a1, n = 48) => Array.from({ length: n + 1 }, (_, i) => {
  const a = (a0 + (a1 - a0) * i / n) * DEG;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
});
// blender angle (deg, counter-clockwise from +x seen from above) -> plan point (three x, three z)
const P = (r, a) => [r * Math.cos(a * DEG), -r * Math.sin(a * DEG)];

export function drawPlan(svg, holes = []) {
  svg.innerHTML = '';
  const g = el(svg, 'g');
  // poché: piers and the outer wall, cut at +2.6 m
  for (let i = 0; i < 12; i++) {
    const a = i * 30 - 0.7;
    const pts = [...arcPts(0, 0, 9.4, -(a - 4.7), -(a + 4.7), 6), ...arcPts(0, 0, 12.5, -(a + 4.7), -(a - 4.7), 6)];
    el(g, 'path', { d: wob(pts, 0.03, i + 3) + 'Z', class: 'fill-r' });
  }
  const door = 257;
  const outer = [...arcPts(0, 0, 13.6, -(door - 6) , -(door - 354), 120), ...arcPts(0, 0, 12.5, -(door - 354), -(door - 6), 120)];
  el(g, 'path', { d: wob(outer, 0.02, 7) + 'Z', class: 'fill-r' });
  el(g, 'path', { d: wob(arcPts(0, 0, 13.6, -(door - 6), -(door - 354), 120), 0.04, 8), class: 'ln ln--b' });
  el(g, 'path', { d: wob(arcPts(0, 0, 9.4, 0, 360, 120), 0.05, 9), class: 'ln' });
  // drowned platform (below the cut: dashed), pedestal, statue
  const sq = (h, cls, seed) => el(g, 'path', { d: wob([[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]], 0.05, seed), class: cls });
  sq(4.74, 'ln ln--d', 11);
  sq(1.55, 'ln ln--b', 12);
  el(g, 'ellipse', { cx: 0.05, cy: 0.1, rx: 0.62, ry: 0.5, class: 'fill-r' });
  // overhead: oculus + the sixteen eyes (dashed)
  el(g, 'path', { d: wob(arcPts(0, 0, 3.0, 0, 360, 60), 0.03, 13), class: 'ln ln--d' });
  holes.slice(0, 16).forEach(([x, , z, r], i) => el(g, 'path', { d: wob(arcPts(x, z, r * 0.9, 0, 360, 24), 0.03, 20 + i), class: 'ln ln--d' }));
  // section line A-A
  el(g, 'path', { d: 'M-16.5 0 L16.5 0', class: 'ln ln--r ln--dd' });
  el(g, 'text', { x: 15.6, y: -0.5, class: 't-cap t-red', 'font-size': '1.1' }, 'A');
  el(g, 'text', { x: -16.6, y: -0.5, class: 't-cap t-red', 'font-size': '1.1' }, 'A');
  // dimension: r 9.6
  const [dx, dz] = P(9.4, 40);
  el(g, 'path', { d: `M0 0 L${dx} ${dz}`, class: 'ln' });
  el(g, 'text', { x: dx * 0.45 + 0.4, y: dz * 0.45 - 0.3, 'font-size': '1.2', transform: `rotate(-40 ${dx * 0.45} ${dz * 0.45})` }, 'r 9.6 m');
  // door
  const [ox, oz] = P(14.8, door), [ix, iz] = P(11.2, door);
  el(g, 'path', { d: `M${ox} ${oz} L${ix} ${iz} M${ix} ${iz} l .45 1.0 M${ix} ${iz} l -.95 .5`, class: 'ln ln--b ln--r' });
  el(g, 'text', { x: ox - 7.8, y: oz + 1.6, class: 't-red', 'font-size': '1.35' }, 'NO ENTRY');
  // labels
  el(g, 'text', { x: 0.9, y: -0.9, 'font-size': '1.15' }, 'the Eye');
  el(g, 'text', { x: -14.8, y: -13.2, 'font-size': '1.15' }, 'ambulatory');
  el(g, 'text', { x: 6.2, y: -11.8, 'font-size': '1.15' }, 'piers ×12');
  el(g, 'text', { x: 2.2, y: 3.6, 'font-size': '1.0' }, '16 eyes + oculus overhead');
  // north + scale
  el(g, 'path', { d: 'M14.2 -12.2 L14.2 -15.6 M14.2 -15.6 l -.6 1.2 M14.2 -15.6 l .6 1.2', class: 'ln' });
  el(g, 'text', { x: 13.75, y: -16.0, class: 't-cap', 'font-size': '.9' }, 'N');
  el(g, 'path', { d: 'M-15.5 15.6 L-5.5 15.6 M-15.5 15.2 L-15.5 16 M-10.5 15.3 L-10.5 15.9 M-5.5 15.2 L-5.5 16', class: 'ln' });
  el(g, 'text', { x: -15.7, y: 15.0, class: 't-cap', 'font-size': '.7' }, '0');
  el(g, 'text', { x: -10.9, y: 15.0, class: 't-cap', 'font-size': '.7' }, '5');
  el(g, 'text', { x: -6.3, y: 15.0, class: 't-cap', 'font-size': '.7' }, '10 m');
  // the hand font, sized in metres (the plan's viewBox unit)
  svg.querySelectorAll('text').forEach((t) => { if (!t.getAttribute('font-size')) t.setAttribute('font-size', '1.2'); });
}

export function drawSection(svg) {
  svg.innerHTML = '';
  const g = el(svg, 'g');
  const Y = (h) => 245 - (h + 1.1) * 10;
  const line = (pts, cls = 'ln', seed = 1, amp = 0.5) => el(g, 'path', { d: wob(pts, amp, seed), class: cls });
  line([[6, Y(-1.1)], [214, Y(-1.1)]], 'ln ln--b', 1);
  line([[6, Y(0)], [214, Y(0)]], 'ln ln--d', 2);
  // piers + ground arch in three orders
  line([[30, Y(-1.1)], [30, Y(4.0)]], 'ln ln--b', 3); line([[48, Y(-1.1)], [48, Y(4.0)]], 'ln', 4);
  line([[172, Y(-1.1)], [172, Y(4.0)]], 'ln', 5); line([[190, Y(-1.1)], [190, Y(4.0)]], 'ln ln--b', 6);
  for (const [r, s] of [[62, 7], [53, 8], [44, 9]]) line(arcPts(110, Y(4.0), r, 180, 360, 40), r === 62 ? 'ln ln--b' : 'ln', s);
  line([[24, Y(4.0)], [54, Y(4.0)]], 'ln', 10); line([[166, Y(4.0)], [196, Y(4.0)]], 'ln', 11);
  // cornice
  line([[10, Y(8.0)], [210, Y(8.0)]], 'ln ln--b', 12); line([[12, Y(8.6)], [208, Y(8.6)]], 'ln', 13);
  // second tier
  line([[78, Y(8.6)], [78, Y(10.4)]], 'ln', 14); line([[142, Y(8.6)], [142, Y(10.4)]], 'ln', 15);
  line(arcPts(110, Y(10.4), 32, 180, 360, 30), 'ln', 16);
  // gallery: two small arches
  for (const [cx, s] of [[80, 17], [140, 18]]) {
    line([[cx - 14, Y(12.4)], [cx - 14, Y(13.6)]], 'ln', s); line([[cx + 14, Y(12.4)], [cx + 14, Y(13.6)]], 'ln', s + 40);
    line(arcPts(cx, Y(13.6), 14, 180, 360, 20), 'ln', s + 80);
  }
  line([[10, Y(15.2)], [210, Y(15.2)]], 'ln ln--b', 19);
  // dome springing -> oculus (half-section)
  line(arcPts(214, Y(15.74), 200, 180, 212, 40).map(([x, y]) => [x, Y(15.74) - (Y(15.74) - y) * 0.62]), 'ln ln--b', 20);
  line([[198, Y(22.3)], [214, Y(22.3)]], 'ln ln--r ln--b', 21);
  const lbl = (h, t, x = 4) => el(g, 'text', { x, y: Y(h) - 3 }, t);
  lbl(0, '±0.0 water'); lbl(4.0, '+4.0 impost'); lbl(8.0, '+8.0 cornice'); lbl(15.2, '+15.7 dome springs');
  el(g, 'text', { x: 122, y: Y(22.3) - 4, class: 't-red' }, '+22.3 oculus');
  el(g, 'text', { x: 118, y: Y(1.8) }, '3 orders');
  el(g, 'text', { x: 6, y: 256, class: 't-cap', 'font-size': '6.5' }, 'SECTION A–A · ONE BAY');
  svg.querySelectorAll('text').forEach((t) => { if (!t.getAttribute('font-size')) t.setAttribute('font-size', '10'); });
}
