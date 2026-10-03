"""Compose the bay elevation sheet as inline SVG: the Freestyle line render of bay I (between the piers at 0 and 30
degrees, seen from inside the ring) + level marks at the generator's exact heights + callouts.
SVG units are metres: x = sideways along the bay (right = toward pier 0), y = -height.
usage: python make_bay_svg.py OUT.html"""
import math, sys

OUT = sys.argv[1]
IMG = 'img/drawings/bay_lines.webp'
W, H, ZC = 7.6, 18.4, 7.6                                       # the render's ortho frame (metres) and centre height
X0, X1 = -3.8, 3.8
f = lambda v: f'{v:.3f}'.rstrip('0').rstrip('.')
el = []


def text(x, y, s, cls='', size=0.5, anchor='start'):
    c = f' class="{cls}"' if cls else ''
    el.append(f'<text x="{f(x)}" y="{f(y)}"{c} font-size="{size}" text-anchor="{anchor}">{s}</text>')


def path(d, cls='ln'):
    el.append(f'<path class="{cls}" d="{d}"/>')


el.append(f'<image href="{IMG}" x="{X0}" y="{f(-(ZC + H / 2))}" width="{W}" height="{H}" preserveAspectRatio="none"/>')
# the niche in the back wall, seen through the great arch: generator numbers (flat width 2.8 m bent onto the ring at
# r 9.6 then pushed back to r 12.5; box to +5.00, half-round head of r 1.40), clipped to the arch opening
RC, RB = 9.6, 12.5
lat = lambda xf: RB * math.sin(xf / RC)                          # flat offset from the bay axis -> lateral offset at the wall
r_i = (RC * 2 * math.pi / 12 - 1.65) / 2
ab = 1.65 / 2                                                    # abacus half-width: the opening between the piers
el.append(f'<clipPath id="arch-open"><path d="M{f(-r_i)} 1.2 L{f(-r_i)} {f(-4.78)} A{f(r_i)} {f(r_i)} 0 0 1 {f(r_i)} {f(-4.78)} L{f(r_i)} 1.2 Z"/></clipPath>')
pts = [(lat(-1.4), 1.1)] + [(lat(1.4 * math.cos(math.pi - k * math.pi / 40)), -(5.0 + 1.4 * math.sin(math.pi - k * math.pi / 40))) for k in range(41)] + [(lat(1.4), 1.1)]
el.append('<g clip-path="url(#arch-open)"><path class="ln ln--g" d="M' + ' L'.join(f'{f(x)} {f(y)}' for x, y in pts) + '"/></g>')

# level marks, right side: tick from the drawing edge, a dashed reference line across, and the height
LEVELS = [(16.05, '+16.05', 'parapet, dome above'), (14.80, '+14.80', 'crown cornice'),
          (12.70, '+12.70', 'upper gallery'), (11.40, '+11.40', 'cornice'), (8.95, '+8.95', 'gallery'),
          (7.20, '+7.20', 'cornice, dentils'), (4.78, '+4.78', 'springing'), (0.0, '±0.00', 'water'), (-1.10, '−1.10', 'floor')]
for z, h, what in LEVELS:
    y = -z
    path(f'M{X1 + 0.15} {f(y)} L{X1 + 0.75} {f(y)}', 'ln ln--b' if z in (0.0,) else 'ln')
    path(f'M{X1 + 0.75} {f(y)} l -0.22 -0.22 M{X1 + 0.75} {f(y)} l 0.22 -0.22', 'ln')          # level triangle
    text(X1 + 1.0, y + 0.19, h, 't-cap t-lvl', 0.46)
    text(X1 + 3.05, y + 0.2, what, 't-sm', 0.5)
# the water line through the drawing
path(f'M{X0} 0 L{X1} 0', 'ln ln--d ln--g')

# callouts, left side (leaders end on the real features); phones drop them for a caption under the drawing
el.append('<g class="wide-only">')
def callout(ax, ay, ty, title, sub=None, red=False):
    lx = X0 - 0.35
    path(f'M{f(lx)} {f(ty - 0.15)} L{f(ax)} {f(ay)}', 'ln ln--r' if red else 'ln')
    el.append(f'<circle cx="{f(ax)}" cy="{f(ay)}" r="0.09" class="{"fill-r" if red else "dot"}"/>')
    text(lx - 0.15, ty, title, 't-red' if red else '', 0.62, 'end')
    if sub: text(lx - 0.15, ty + 0.62, sub, 't-sm', 0.44, 'end')

r_i = (9.6 * 2 * math.pi / 12 - 1.65) / 2                      # intrados radius of the great arch (generator: (L - abacus_w) / 2)
callout(-0.02, -(4.78 + r_i) + 0.02, -9.3 + 2.4, 'crown +6.47', 'fifteen voussoirs, two slipped', red=True)
callout(-2.49, -4.35, -4.6, 'three columns', 'carved capitals')
callout(-1.05, -3.2, -1.6, 'the niche', '2.9 m behind the arch')
callout(-1.13, -10.4, -10.8, 'gallery')
callout(-1.24, -13.85, -14.2, 'upper gallery')

# title + scale
text(X0 - 5.1, -16.55, 'BAY I · ELEVATION', 't-cap', 0.5)
text(X0 - 5.1, -15.85, 'from the water, looking out', 't-sm', 0.4)
path(f'M{X0 - 4.4} 1.45 L{X0 - 2.4} 1.45 M{X0 - 4.4} 1.3 L{X0 - 4.4} 1.6 M{X0 - 3.4} 1.35 L{X0 - 3.4} 1.55 M{X0 - 2.4} 1.3 L{X0 - 2.4} 1.6', 'ln')
text(X0 - 4.4, 1.15, '0', 't-cap', 0.32, 'middle')
text(X0 - 2.4, 1.15, '2 m', 't-cap', 0.32, 'middle')
el.append('</g>')

vb = (X0 - 5.3, -17.2, (X1 + 6.9) - (X0 - 5.3), 19.0)
# phones: the drawing and its levels, without the left callouts
vt = (X0 - 0.2, -17.2, (X1 + 6.9) - (X0 - 0.2), 19.0)
svg = (f'<svg class="drawing elev-drawing" viewBox="{" ".join(f(v) for v in vb)}" data-vb-wide="{" ".join(f(v) for v in vb)}" data-vb-tight="{" ".join(f(v) for v in vt)}" role="img" aria-label="Elevation of one bay, '
       'drawn from the 3D model: three-column piers with carved capitals carrying a round arch, a cornice with dentils, '
       'a gallery of two arches, an upper gallery of three, and the crown cornice where the dome springs">\n' + '\n'.join(el) + '\n</svg>')
open(OUT, 'w').write(svg)
print('svg bytes', len(svg), 'viewBox', vb)
