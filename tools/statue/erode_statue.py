"""Weather La Custode: nobody knows how old she is, so she should look like it.
Operates on the full-resolution statue (topology unchanged, so UV sets and masks survive):
  1. rain wear on everything that faces the sky (fbm, deeper on the head, more on her weather side)
  2. features worn soft: Taubin smoothing weighted over the face (eyelids, lips, nostrils lose their edges)
  3. the nose snapped off at the bridge: an oblique fracture plane, with a granular break surface
  4. chips bitten out of exposed edges (chin, brow, drapery folds)
  5. a hairline crack across the brow
  6. rain channels: down her cheeks from the eyes, down the back of the head, down the drapery from the shoulders
  7. sugaring: fine pitting of the marble
usage: python erode_statue.py IN.npz OUT.npz HEAD_FRAME.npz"""
import math, sys, time
import numpy as np
import scipy.sparse as sp

IN, OUT, HF = sys.argv[1:4]
t0 = time.time()
d = dict(np.load(IN))
V = d['V'].astype(np.float64)
F = d['F'].astype(np.int64)
n = len(V)
hf = np.load(HF)
fwd, up0, tip = hf['fwd'], hf['up'], hf['tip']
right = np.cross(fwd, up0); right /= np.linalg.norm(right)
up = np.cross(right, fwd); up /= np.linalg.norm(up)
H = tip - fwd * 0.17                                            # head centre, behind the nose
Zw = np.array([0, 0, 1.0])
rng = np.random.default_rng(1607)


def normals(V):
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    vn = np.zeros_like(V)
    for k in range(3):
        for c in range(3):
            vn[:, c] += np.bincount(F[:, k], fn[:, c], minlength=n)
    return vn / (np.linalg.norm(vn, axis=1, keepdims=True) + 1e-15)


def _hash(ix, iy, iz, seed):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    h = h & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h = h ^ (h >> 16)
    return (h & 0xFFFF) / 65535.0


def vnoise(P, seed=0):
    Pi = np.floor(P).astype(np.int64); f = P - Pi; u = f * f * (3 - 2 * f)
    out = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
                out = out + w * _hash(Pi[:, 0] + dx, Pi[:, 1] + dy, Pi[:, 2] + dz, seed)
    return out


def fbm(P, oct=4, seed=0):
    s, a, tot = 0.0, 0.5, 0.0
    for o in range(oct):
        s = s + a * vnoise(P * (2.03 ** o), seed + o * 17); tot += a; a *= 0.5
    return s / tot


def worley(P, seed=0):
    """distance to the nearest feature point (one per unit cell)"""
    Pi = np.floor(P).astype(np.int64)
    best = np.full(len(P), 9.0)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                c = Pi + np.array([dx, dy, dz])
                fp = c + np.stack([_hash(c[:, 0], c[:, 1], c[:, 2], seed + k) for k in range(3)], 1)
                best = np.minimum(best, np.linalg.norm(P - fp, axis=1))
    return best


sstep = lambda a, b, x: np.clip((x - a) / (b - a), 0, 1) ** 2 * (3 - 2 * np.clip((x - a) / (b - a), 0, 1))
N = normals(V)
rel = V - H
fu, fv, ff = rel @ right, rel @ up, rel @ fwd                  # head frame: right, up, forward
dH = np.linalg.norm(rel, axis=1)
w_head = 1 - sstep(0.19, 0.30, dH)
face_c = tip - fwd * 0.03 + up * 0.015
w_face = np.exp(-(np.linalg.norm(V - face_c, axis=1) / 0.085) ** 2) * sstep(-0.1, 0.35, N @ fwd)
weather_side = 0.65 + 0.7 * sstep(-0.12, 0.12, fu)             # her right side took the weather
print('frame ok', round(time.time() - t0, 1), 's; head verts', int((w_head > 0.5).sum()), 'face verts', int((w_face > 0.3).sum()), flush=True)

# 1. rain wear: everything facing the sky loses a few millimetres, unevenly
sky = np.clip(N @ Zw, 0, 1)
wear = (0.0012 + 0.0045 * sky ** 1.5) * (0.55 + 0.9 * fbm(V * 9.0, 4, 3)) * (1 + 1.2 * w_head) * weather_side
V -= N * wear[:, None]

# 2. features worn soft (Taubin, weighted to the face and a little over the whole head)
I, J = np.concatenate([F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]]), np.concatenate([F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]])
A = sp.csr_matrix((np.ones(len(I)), (I, J)), shape=(n, n)); A.data[:] = 1.0
deg = np.asarray(A.sum(1)).ravel()
Dinv = sp.diags(1.0 / np.maximum(deg, 1))
ws = np.clip(w_face * 1.0 * weather_side + w_head * 0.25, 0, 1)[:, None]
for it in range(14):
    for lam in (0.55, -0.58):
        V += lam * ws * (Dinv @ (A @ V) - V)
# the eyes go first: their carved edges wear into soft hollows (her left eye, on the weather side, more)
for sgn, k_it in ((1, 44), (-1, 32)):
    ec = tip + up * 0.05 + right * 0.047 * sgn - fwd * 0.048          # measured: the deepest hollows either side of the nose
    we = (np.exp(-(np.linalg.norm(V - ec, axis=1) / 0.033) ** 2))[:, None]
    for it in range(k_it // 2):                                     # plain Laplacian: lids wear down, hollows go shallow
        V += 0.5 * we * (Dinv @ (A @ V) - V)
# lips and the rest of the face lose their edges too (a little shrinking is what wear is)
wl = (np.exp(-(np.linalg.norm(V - (tip - up * 0.045 - fwd * 0.03), axis=1) / 0.035) ** 2) * 0.9 + w_face * 0.35)[:, None]
for it in range(10):
    V += 0.45 * wl * (Dinv @ (A @ V) - V)
print('worn soft', round(time.time() - t0, 1), 's', flush=True)

# 3. the nose, snapped off at the bridge (an oblique break, granular)
nb = fwd * math.cos(math.radians(24)) + up * math.sin(math.radians(24)) + right * 0.18
nb /= np.linalg.norm(nb)
q = tip - fwd * 0.021 + up * 0.004
dn = (V - q) @ nb
nose = (np.linalg.norm(V - tip, axis=1) < 0.055) & (dn > 0)
V[nose] -= np.outer(dn[nose], nb)
grain = fbm(V[nose] * 150, 4, 11)
V[nose] -= np.outer(0.0034 * (grain - 0.25), nb)
print('nose: moved', int(nose.sum()), 'verts', flush=True)

# 4. chips: bites out of exposed convex places (spheres pushed into the surface)
N = normals(V)
curv = np.linalg.norm(Dinv @ (A @ V) - V, axis=1) * np.sign(-np.einsum('ij,ij->i', Dinv @ (A @ V) - V, N))
cands = np.where((curv > np.percentile(curv, 99.3)) & (V[:, 2] > 2.2))[0]
face_zone = np.linalg.norm(V - tip, axis=1) < 0.09               # the face gets its own, deliberate damage
cands = cands[~face_zone[cands]]
for k in rng.choice(cands, size=26, replace=False):
    r = rng.uniform(0.012, 0.03) * (1.3 if dH[k] < 0.25 else 1.0)
    c = V[k] + N[k] * r * rng.uniform(0.62, 0.82)                  # shallow scoops, not holes
    dv = V - c; dist = np.linalg.norm(dv, axis=1)
    m = dist < r
    V[m] = c + dv[m] / dist[m, None] * r
# the chin and the left brow always lose a corner on a statue this old
for p0, r in ((tip - up * 0.105 + right * 0.04 - fwd * 0.035, 0.024), (tip + up * 0.085 + right * 0.05 - fwd * 0.03, 0.02)):
    N_ = normals(V); k = np.argmin(np.linalg.norm(V - p0, axis=1))
    c = V[k] + N_[k] * r * 0.72
    dv = V - c; dist = np.linalg.norm(dv, axis=1); m = dist < r
    V[m] = c + dv[m] / dist[m, None] * r
print('chips', round(time.time() - t0, 1), 's', flush=True)

# 5. a hairline crack across the brow and down the cheek (front of the head only)
N = normals(V)
rel = V - H; fu, fv, ff = rel @ right, rel @ up, rel @ fwd
crack = np.array([(-0.06, 0.115), (-0.042, 0.088), (-0.03, 0.074), (-0.012, 0.066), (0.004, 0.05), (0.018, 0.041), (0.03, 0.022), (0.041, 0.008), (0.052, -0.016)])
uv = np.stack([fu, fv], 1)
dmin = np.full(n, 9.0)
for a, b in zip(crack[:-1], crack[1:]):
    ab = b - a; t = np.clip(((uv - a) @ ab) / (ab @ ab), 0, 1)
    dmin = np.minimum(dmin, np.linalg.norm(uv - (a + t[:, None] * ab), axis=1))
front = (ff > 0.05) & (dH < 0.26) & ((N @ fwd) > 0.1)
groove = 0.0035 * np.exp(-(dmin / 0.0016) ** 2) * front
V -= N * groove[:, None]

# 6. rain channels
def channels(mask, u, v, starts, depth, width, length):
    out = np.zeros(n)
    for u0, v0, ph in starts:
        L = length * rng.uniform(0.7, 1.15)
        uc = u0 + 0.003 * np.sin((v0 - v) * 70 + ph) + 0.06 * (v0 - v) * rng.uniform(-0.15, 0.15)
        along = (v0 - v) / L
        fade = sstep(0.0, 0.08, along) * (1 - sstep(0.6, 1.0, along))
        out = np.maximum(out, np.exp(-((u - uc) / width) ** 2) * fade * mask)
    return out * depth

face_front = ((N @ fwd) > 0.15) & (ff > 0.02) & (dH < 0.27)
eyes = [(-0.032, 0.03, 0.4), (-0.02, 0.022, 1.3), (0.017, 0.024, 2.1), (0.031, 0.028, 2.9), (0.045, 0.02, 0.7), (-0.045, 0.018, 1.9)]
ch = channels(face_front, fu, fv, eyes, 0.0016, 0.0022, 0.13)
theta = np.arctan2(V[:, 1], V[:, 0]); R = np.hypot(V[:, 0], V[:, 1])
body = (V[:, 2] < H[2] - 0.12) & (V[:, 2] > 2.05) & (R > 0.08)
starts = [(th, H[2] - 0.2 + rng.uniform(-0.12, 0.05), rng.uniform(0, 6)) for th in np.linspace(-math.pi, math.pi, 34, endpoint=False) + rng.uniform(-0.05, 0.05, 34)]
ch_b = channels(body, theta * 0.3, V[:, 2], [(a * 0.3, z, p) for a, z, p in starts], 0.0024, 0.0035, 1.15)
back = (dH < 0.3) & (ff < -0.02)
ch_h = channels(back, fu, fv, [(u, 0.17, p) for u, p in zip(rng.uniform(-0.12, 0.12, 9), rng.uniform(0, 6, 9))], 0.0018, 0.003, 0.26)
V -= N * (ch + ch_b + ch_h)[:, None]

# 7. sugaring: fine pits all over, deeper on the head
pits = sstep(0.42, 0.0, worley(V * 70.0, 5)) * (0.0005 + 0.0009 * w_head)
V -= N * pits[:, None]

# the breaks are old: weather rounds their edges again
ws2 = np.clip(w_head * 0.9 + 0.25, 0, 1)[:, None]
for it in range(3):
    for lam in (0.5, -0.53):
        V += lam * ws2 * (Dinv @ (A @ V) - V)

disp = np.linalg.norm(V - d['V'].astype(np.float64), axis=1)
print('displacement: mean %.2f mm, p99 %.1f mm, max %.1f mm' % (disp.mean() * 1e3, np.percentile(disp, 99) * 1e3, disp.max() * 1e3))
d['V'] = V.astype(np.float32)
np.savez_compressed(OUT, **d)
print('saved', OUT, round(time.time() - t0, 1), 's')
