"""Side-lit render of the weathered head for the pencil study (alpha kept for the background)."""
import os, sys, math, numpy as np
sys.path.insert(0, os.environ.get("ROTUNDA_GENERATOR", "../Colosseum/generator"))   # the procedural generator (Colosseum repo)
import blender_util as bu, bpy
from meshkit import Mesh
src, hfp, out = sys.argv[1:4]
d = np.load(src); V = d['V'].astype(np.float64); F = d['F'].astype(np.int64)
hf = np.load(hfp); fwd, up0, tip = hf['fwd'], hf['up'], hf['tip']
right = np.cross(fwd, up0); right /= np.linalg.norm(right); up = np.cross(right, fwd)
H = tip - fwd * 0.17
keep = np.linalg.norm(V[F].mean(1) - H, axis=1) < 0.42
F = F[keep]; used = np.unique(F); remap = -np.ones(len(V), np.int64); remap[used] = np.arange(len(used))
sc = bu.reset_scene(); clay = bu.clay_material((0.82, 0.8, 0.76), 0.6)
bu.add_object("head", Mesh(V[used], remap[F]), [clay], normals_angle=None)
bu.setup_cycles(samples=96, res=(700, 700))
sc.render.film_transparent = True
bu.world_color((0.5, 0.52, 0.55), 0.16)
bu.add_sun(tuple(-right * 0.82 + up * 0.5 + fwd * 0.3), strength=5.0)
c = H + up * 0.035 + fwd * 0.05
dv = fwd * 0.97 - right * 0.22; dv /= np.linalg.norm(dv)
bu.add_camera(tuple(c + dv * 0.92), tuple(c), lens=70)
bu.render_to(out)
