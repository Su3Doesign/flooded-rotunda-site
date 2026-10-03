// Red-pencil marks over the book pages — the art director's circles, arrows and underlines.
// Authored in the HTML as data attributes and generated from each element's box, so they fit at any width:
//   data-mk="circle"                         loose double loop around the element
//   data-mk="underline"                      wavy stroke under it
//   data-mk="arrow" data-mk-from="sel" data-mk-fp="fx,fy" data-mk-to="sel" data-mk-tp="tx,ty"
//                                            curved arrow from a point of one child (the note) to a point of another
//                                            (the thing it is about): fractions of each child's box, so it always connects
//   data-mk-ink="graphite"                   pencil instead of red
// Nothing is allowed to reach past the edge of the screen (that made the page scroll sideways on phones).
const NS = 'http://www.w3.org/2000/svg';

function rng(seed) {
  let s = (seed * 2654435761) % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function circle(w, h, r, room) {
  const cx = w / 2, cy = h / 2, rx = Math.min(w / 2 + 10 + r() * 6, w / 2 + room - 5), ry = h / 2 + 10 + r() * 8;
  const a0 = -2.2 + r() * 0.8, turns = 1.1 + r() * 0.14, ph = r() * 6.28, n = 72;
  let d = '';
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = a0 + t * turns * Math.PI * 2;
    const k = 1 + 0.03 * Math.sin(3 * a + ph) + 0.02 * Math.sin(7 * a + ph * 2) + (t > 0.85 ? (t - 0.85) * 0.35 : 0);
    d += `${i ? 'L' : 'M'}${(cx + rx * k * Math.cos(a)).toFixed(1)} ${(cy + ry * k * Math.sin(a)).toFixed(1)}`;
  }
  return { d, pad: 26 };
}

function underline(w, h, r) {
  const y = h + 6, n = 24;
  let d = '';
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    d += `${i ? 'L' : 'M'}${(-4 + t * (w + 8)).toFixed(1)} ${(y + Math.sin(t * 9 + r() * 0.4) * 1.6 + t * 2.5).toFixed(1)}`;
  }
  const back = ` M${(w + 2).toFixed(1)} ${(y + 4).toFixed(1)} Q ${(w * 0.55).toFixed(1)} ${(y + 9).toFixed(1)} ${(w * 0.12).toFixed(1)} ${(y + 7).toFixed(1)}`;
  return { d: d + back, pad: 16 };
}

function arrow(w, h, r, [x0, y0, x1, y1]) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  const bend = (0.18 + r() * 0.12) * (r() > 0.5 ? 1 : -1);
  const cx = (x0 + x1) / 2 - dy * bend, cy = (y0 + y1) / 2 + dx * bend;
  // tangent at the tip for the head
  const tx2 = x1 - cx, ty2 = y1 - cy, tl = Math.hypot(tx2, ty2) || 1;
  const ux = tx2 / tl, uy = ty2 / tl, head = Math.min(18, L * 0.22);
  const rot = (a) => [ux * Math.cos(a) - uy * Math.sin(a), ux * Math.sin(a) + uy * Math.cos(a)];
  const [h1x, h1y] = rot(2.65), [h2x, h2y] = rot(-2.65);
  const d = `M${x0.toFixed(1)} ${y0.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`
    + ` M${x1.toFixed(1)} ${y1.toFixed(1)} l ${(h1x * head).toFixed(1)} ${(h1y * head).toFixed(1)}`
    + ` M${x1.toFixed(1)} ${y1.toFixed(1)} l ${(h2x * head).toFixed(1)} ${(h2y * head).toFixed(1)}`;
  return { d, box: [Math.min(x0, x1, cx) - 20, Math.min(y0, y1, cy) - 20, Math.max(x0, x1, cx) + 20, Math.max(y0, y1, cy) + 20] };
}

export function buildMark(el) {
  el.querySelectorAll(':scope > svg.mk-auto').forEach((s) => s.remove());
  const w = el.offsetWidth, h = el.offsetHeight;
  if (!w || !h) return null;
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  const all = [...document.querySelectorAll('[data-mk]')];
  const r = rng(all.indexOf(el) + 7);
  const kind = el.dataset.mk;
  let res;
  const box = el.getBoundingClientRect(), vw = document.documentElement.clientWidth;
  const room = Math.max(0, Math.min(box.left, vw - box.right));          // free space to the nearer screen edge
  if (kind === 'circle') res = circle(w, h, r, room);
  else if (kind === 'underline') res = underline(Math.min(w, vw - box.left - 14), h, r);
  else {
    // a point inside a child, in the element's own (untransformed) layout coordinates
    const at = (sel, fr) => {
      const t = (sel && el.querySelector(sel)) || el, [fx, fy] = fr.split(',').map(Number);
      if (t.offsetParent === undefined) {                                  // svg child: no layout offsets, use its box
        const b = t.getBoundingClientRect();
        return [b.left - box.left + fx * b.width, b.top - box.top + fy * b.height];
      }
      let x = 0, y = 0;
      for (let n = t; n && n !== el; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
      return [x + fx * t.offsetWidth, y + fy * t.offsetHeight];
    };
    const [x0, y0] = at(el.dataset.mkFrom, el.dataset.mkFp || '0,0.5'), [x1, y1] = at(el.dataset.mkTo, el.dataset.mkTp || '0.5,0.5');
    const clampX = (x) => Math.max(-box.left + 8, Math.min(vw - box.left - 8, x));
    res = arrow(w, h, r, [clampX(x0), y0, clampX(x1), y1]);
  }
  let [bx0, by0, bx1, by1] = res.box || [-res.pad, -res.pad, w + res.pad, h + res.pad];
  // the svg box itself must stay on screen (a box past the edge is what scrolls a phone sideways); strokes may overhang it
  bx0 = Math.max(bx0, -box.left + 1); bx1 = Math.min(bx1, vw - box.left - 1);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'mk-auto' + (el.dataset.mkInk === 'graphite' ? ' mk-auto--ink' : ''));
  svg.setAttribute('viewBox', `${bx0} ${by0} ${bx1 - bx0} ${by1 - by0}`);
  svg.setAttribute('aria-hidden', 'true');
  Object.assign(svg.style, { left: `${bx0}px`, top: `${by0}px`, width: `${bx1 - bx0}px`, height: `${by1 - by0}px` });
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', res.d);
  svg.appendChild(p);
  el.appendChild(svg);
  const L = p.getTotalLength();
  p.style.strokeDasharray = `${L}`;
  p.style.strokeDashoffset = el.dataset.mkDrawn ? '0' : `${L}`;
  return { el, p, L };
}

// after a resize, redraw the marks that were already drawn (the others are built when they scroll in)
export function rebuildDrawn() {
  document.querySelectorAll('[data-mk][data-mk-drawn]').forEach((el) => buildMark(el));
}
