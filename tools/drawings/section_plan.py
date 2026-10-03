"""Exact cut of the real geometry at z = +2.6 m (Blender frame) as poché polygons, in plan coordinates
(x right, y down = three.js z, metres). Adjacent bays are merged, so their seams disappear like real masonry."""
import json, sys
import numpy as np
import trimesh
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.ops import polygonize, unary_union

GEO9, GEO10, OUT = sys.argv[1:4]
Z = 2.6

def cut(path):
    d = np.load(path)
    V, F = d['V'].astype(np.float64), d['F'].astype(np.int64)
    T = V[F]
    keep = (T[:, :, 2].min(1) < Z + 0.01) & (T[:, :, 2].max(1) > Z - 0.01)
    m = trimesh.Trimesh(V, F[keep], process=True)                  # process: merge duplicate vertices so loops close
    sec = m.section(plane_origin=[0, 0, Z], plane_normal=[0, 0, 1])
    if sec is None: return []
    return [LineString(np.asarray(e)[:, :2] * np.array([1, -1])) for e in sec.discrete if len(e) > 1]

def polys(lines):
    ps = [p for p in polygonize(unary_union(lines)) if p.area > 1e-4]
    return unary_union(ps)

def rings(g, tol=0.006):
    g = g.simplify(tol)
    geoms = g.geoms if isinstance(g, MultiPolygon) else [g]
    out = []
    for p in geoms:
        if p.is_empty: continue
        out.append([np.round(np.asarray(p.exterior.coords), 3).tolist()] + [np.round(np.asarray(r.coords), 3).tolist() for r in p.interiors])
    return out

bays = []
for i in range(12): bays += cut(f'{GEO9}/arcade_bay_{i:02d}.npz')
wall = polys(bays)
statue = polys(cut(f'{GEO10}/statue.npz'))
res = {'bays': rings(wall), 'statue': rings(statue)}
print('bay polygons', len(res['bays']), 'statue', len(res['statue']), 'area', round(wall.area, 2), round(statue.area, 3))
json.dump(res, open(OUT, 'w'))
