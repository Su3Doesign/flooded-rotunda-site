"""Graphite study from a render (RGBA). Strokes are noise smeared along a direction (line-integral style), switched on
by tone: one direction in the half-tones, crossed in the shadows, a third in the darkest. Broken contours, a loose
background, paper underneath.  usage: python pencil.py IN.png PAPER.jpg OUT.jpg"""
import sys, numpy as np
from PIL import Image
from scipy import ndimage as ndi
src, paper, out = sys.argv[1:4]
im = Image.open(src).convert('RGBA'); W, H = im.size
a = np.asarray(im).astype(np.float32) / 255
A = a[..., 3]
L = (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]) / np.maximum(A, 1e-3)
L = np.where(A > 0.02, np.clip(L, 0, 1), 1.0)
rng = np.random.default_rng(7)


def strokes(angle, length=25, seed=0):
    r = np.random.default_rng(seed)
    n = r.random((H, W)) ** 3                                   # sparse bright specks -> strokes after smearing
    k = np.zeros((length, length)); c = length // 2
    for t in np.linspace(-c, c, length * 3):
        k[int(round(c + t * np.sin(angle))), int(round(c + t * np.cos(angle)))] = 1
    s = ndi.convolve(n, k / k.sum(), mode='wrap')
    s = ndi.gaussian_filter(s, 0.6)
    return (s - s.mean()) / s.std()


t = 1 - L ** 0.7
ss = lambda e0, e1, x: np.clip((x - e0) / (e1 - e0), 0, 1)
S1, S2, S3, S4 = strokes(-0.80, 27, 1), strokes(0.78, 23, 2), strokes(-0.15, 19, 3), strokes(-0.86, 31, 4)
ink1 = ss(2.9 - 3.4 * t, 3.5 - 3.4 * t, S1) * ss(0.12, 0.3, t)
ink2 = ss(3.0 - 3.0 * t, 3.6 - 3.0 * t, S2) * ss(0.4, 0.55, t)
ink3 = ss(3.0 - 2.8 * t, 3.6 - 2.8 * t, S3) * ss(0.62, 0.78, t)
shade = 1 - (1 - ink1) * (1 - ink2) * (1 - ink3)
shade = shade * 0.75 + ndi.gaussian_filter(t, 2.0) ** 1.25 * 0.5   # graphite rubbed into the form, under the strokes
# contours: sketchy, broken, a bit doubled
Lb = ndi.gaussian_filter(L, 1.2)
edge = ss(0.08, 0.32, np.hypot(ndi.sobel(Lb, 1), ndi.sobel(Lb, 0)))
sil = ss(0.15, 0.9, np.hypot(ndi.sobel(ndi.gaussian_filter(A, 0.8), 1), ndi.sobel(ndi.gaussian_filter(A, 0.8), 0)))
brk = ss(-0.6, 0.4, ndi.gaussian_filter(rng.standard_normal((H, W)), 3) * 3)
sil2 = np.roll(np.roll(sil, 2, 0), -1, 1) * 0.35                # the second, looser pass of the outline
contour = np.clip((edge * 0.7 + sil * 0.5) * (0.4 + 0.6 * brk) + sil2 * brk * 0.6, 0, 1)
# background: loose strokes, denser toward the shadow side, fading out at the edges
side = ss(0.9, 0.1, xx := (np.mgrid[0:H, 0:W][1] / W)) * 0.7 + 0.3
bg = ss(2.2, 3.4, S4) * (1 - A) * side * 0.4
ink = np.clip(shade * A + contour + bg, 0, 1)
P = Image.open(paper).convert('RGB')
sc = W / 900
P = P.resize((int(P.width * sc) + 2, int(P.height * sc) + 2))
P = P.crop((0, 0, W, H)) if P.width >= W and P.height >= H else P.resize((W, H))
p = np.asarray(P).astype(np.float32) / 255
graphite = np.array([0.13, 0.125, 0.12])
res = p * (1 - ink[..., None] * 0.88) + graphite * ink[..., None] * 0.88 * 0.25
Image.fromarray((np.clip(res, 0, 1) * 255).astype(np.uint8)).save(out, quality=88)
