"""Compose the plan sheet as inline SVG: the Freestyle line render (below the cut) + the exact poché + labels.
Coordinates are metres in plan space: x right, y down (= three.js x, z). Blender angle a sits at (r cos a, -r sin a).
usage: python make_plan_svg.py plan_cut.json scene.json OUT.html"""
import json, math, sys

cut = json.load(open(sys.argv[1]))
scene = json.load(open(sys.argv[2]))
OUT = sys.argv[3]
IMG = 'img/drawings/plan_lines.webp'
S_IMG = 29.0                                                   # ortho scale of the render (metres across)

D = math.pi / 180
P = lambda r, a: (r * math.cos(a * D), -r * math.sin(a * D))
f = lambda v: f'{v:.3f}'.rstrip('0').rstrip('.')
el = []


def path_rings(rings):
    d = ''
    for ring in rings:
        d += 'M' + ' L'.join(f'{f(x)} {f(y)}' for x, y in ring) + 'Z'
    return d


def text(x, y, s, cls='', size=1.25, anchor='start', extra=''):
    c = f' class="{cls}"' if cls else ''
    el.append(f'<text x="{f(x)}" y="{f(y)}"{c} font-size="{size}" text-anchor="{anchor}"{extra}>{s}</text>')


def leader(ax, ay, lx, ly, red=False, elbow=None):
    """dot on the feature, a line to the label; optional elbow so it leaves the label horizontally"""
    pts = [(lx, ly)] + ([elbow] if elbow else []) + [(ax, ay)]
    d = 'M' + ' L'.join(f'{f(x)} {f(y)}' for x, y in pts)
    el.append(f'<path class="ln{" ln--r" if red else ""}" d="{d}"/>')
    el.append(f'<circle cx="{f(ax)}" cy="{f(ay)}" r="0.2" class="{"fill-r" if red else "dot"}"/>')


# 1. what lies below the knife: Freestyle lines of the real meshes
el.append(f'<image href="{IMG}" x="{-S_IMG / 2}" y="{-S_IMG / 2}" width="{S_IMG}" height="{S_IMG}" preserveAspectRatio="none"/>')
# 2. overhead, dashed: the oculus and the eyes in the dome
el.append('<g class="overhead">')
el.append('<circle cx="0" cy="0" r="3" class="ln ln--d"/>')
for x, y, z, r in scene['holes']:
    if y > 16.5 and r < 2.5:                                   # the dome's eyes (the oculus is drawn above)
        el.append(f'<circle cx="{f(x)}" cy="{f(z)}" r="{f(r * 0.9)}" class="ln ln--d"/>')
el.append('</g>')
# 3. the cut: exact section of the real geometry at +2.6 m
el.append(f'<path class="fill-r ln ln--b" d="{path_rings([p for poly in cut["bays"] for p in poly])}" fill-rule="evenodd"/>')
el.append(f'<path class="fill-r ln ln--b" d="{path_rings([p for poly in cut["statue"] for p in poly])}" fill-rule="evenodd"/>')
# 4. bay numerals, in the ambulatory between the clusters
NUM = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
for i, n in enumerate(NUM):
    x, y = P(11.05, i * 30 + 15)
    if n == 'IX': continue                                     # the door bay carries its own mark
    text(x, y + 0.32, n, 't-cap t-num', 0.85, 'middle')

# 5. labels (all outside the ring, leaders to the exact features); phones show the ring alone and a caption below
L = 1.22
el.append('<g class="wide-only">')
# title block, top left
text(-21.4, -15.6, 'PLAN · CUT AT +2.6 M', 't-cap', 0.95)
text(-21.4, -14.1, 'red: stone the knife went through', 't-red', 1.0)
# La Custode (statue cut at the knee)
leader(0.25, -0.05, -14.2, -9.6, elbow=(-6.5, -9.6))
text(-21.4, -9.95, 'La Custode', '', L)
text(-21.4, -8.75, 'cut at the knee, on her plinth', 't-sm', 0.78)
# ambulatory
ax, ay = P(11.0, 172)
leader(ax, ay, -14.2, -3.4, elbow=(-12.6, -3.4))
text(-21.4, -3.75, 'ambulatory', '', L)
text(-21.4, -2.55, 'flooded, 1.1 m deep', 't-sm', 0.78)
# platform
ax, ay = P(4.62, 214)
leader(ax, ay, -14.2, 7.0, elbow=(-6.0, 7.0))
text(-21.4, 6.65, 'platform, drowned', '', L)
text(-21.4, 7.85, 'round, Ø 9.5 m', 't-sm', 0.78)
# clusters (top right)
ax, ay = P(9.6, 60)
leader(ax, ay, 14.2, -9.6, elbow=(7.6, -9.6))
text(14.6, -9.95, '12 piers', '', L)
text(14.6, -8.75, 'three columns each', 't-sm', 0.78)
# niche
ax, ay = P(12.9, 15)
leader(ax, ay, 14.2, -3.4, elbow=(13.6, -3.4))
text(14.6, -3.75, 'a niche', '', L)
text(14.6, -2.55, 'in every bay', 't-sm', 0.78)
# overhead
ax, ay = P(3.0, -40)
leader(ax, ay, 14.2, 7.0, elbow=(6.2, 7.0))
text(14.6, 6.65, 'overhead', '', L)
text(14.6, 7.85, 'oculus + 16 eyes, dashed', 't-sm', 0.78)
el.append('</g>')
# elevation marker on bay I (the bay drawn on page 2): a view arrow from inside
x0, y0 = P(6.3, 15); x1, y1 = P(8.5, 15)
el.append(f'<path class="ln ln--b" d="M{f(x0)} {f(y0)} L{f(x1)} {f(y1)}"/>')
ux, uy = (x1 - x0) / 2.2, (y1 - y0) / 2.2
for s in (1, -1):
    hx, hy = x1 - 0.7 * ux - s * 0.45 * uy, y1 - 0.7 * uy + s * 0.45 * ux
    el.append(f'<path class="ln ln--b" d="M{f(x1)} {f(y1)} L{f(hx)} {f(hy)}"/>')
tx, ty = P(5.4, 15)
text(tx, ty + 0.35, 'E', 't-cap', 0.9, 'middle')
# NO ENTRY: the planks across bay IX
ax, ay = P(9.2, 257)
bx, by = P(15.2, 257)
el.append(f'<path class="ln ln--r ln--b" d="M{f(bx)} {f(by)} L{f(ax)} {f(ay)}"/>')
ux, uy = (ax - bx), (ay - by); n = math.hypot(ux, uy); ux, uy = ux / n, uy / n
for s in (1, -1):
    hx, hy = ax - 0.9 * ux - s * 0.5 * uy, ay - 0.9 * uy + s * 0.5 * ux
    el.append(f'<path class="ln ln--r ln--b" d="M{f(ax)} {f(ay)} L{f(hx)} {f(hy)}"/>')
for s in (-1, 1):                                              # the two planks, crossed
    p0, p1 = P(9.15, 257 - s * 6.5), P(9.15, 257 + s * 6.5)
    el.append(f'<path class="ln ln--r ln--b" d="M{f(p0[0])} {f(p0[1] - 0.25 * s)} L{f(p1[0])} {f(p1[1] + 0.25 * s)}"/>')
text(bx - 0.3, by + 1.55, 'NO ENTRY', 't-cap t-red', 1.05, 'end')
text(bx + 0.3, by + 1.5, 'bay IX, the only door', 't-red', 1.0, 'start')
# north + scale, bottom right (clear of the door)
el.append('<g class="wide-only">')
el.append('<path class="ln" d="M20.6 -13.0 L20.6 -16.2 M20.6 -16.2 L20.05 -15.0 M20.6 -16.2 L21.15 -15.0"/>')
text(20.6, -16.65, 'N', 't-cap', 0.8, 'middle')
el.append('<path class="ln" d="M11.5 15.9 L21.5 15.9 M11.5 15.45 L11.5 16.35 M16.5 15.6 L16.5 16.2 M21.5 15.45 L21.5 16.35"/>')
el.append('<rect x="11.5" y="15.75" width="5" height="0.3" class="fill-ink"/>')
text(11.5, 15.0, '0', 't-cap', 0.7, 'middle')
text(16.5, 15.0, '5', 't-cap', 0.7, 'middle')
text(21.5, 15.0, '10 m', 't-cap', 0.7, 'end')
el.append('</g>')

svg = ('<svg class="drawing plan-drawing" viewBox="-22 -17.6 44 35.2" data-vb-wide="-22 -17.6 44 35.2" data-vb-tight="-14.4 -14.4 28.8 32.6" role="img" aria-label="Plan of the rotunda cut at 2.6 metres, '
       'drawn from the 3D model: twelve piers of three columns on a ring, the outer wall with a niche in every bay, the statue at the centre, '
       'and the door bay marked no entry">\n' + '\n'.join(el) + '\n</svg>')
open(OUT, 'w').write(svg)
print('svg bytes', len(svg))
