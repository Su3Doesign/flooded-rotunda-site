"""Clay head renders of the final statue (same recipe as the v1-v5 head studies), from a world-space statue mesh.
usage: python render_head_v6.py STATUE.npz HEAD_FRAME.npz OUTPREFIX [res] [views]"""
import os, sys, math, numpy as np
sys.path.insert(0, os.environ.get("ROTUNDA_GENERATOR", "../Colosseum/generator"))   # the procedural generator (Colosseum repo)
import blender_util as bu, bpy
from meshkit import Mesh
src, hfp, out = sys.argv[1:4]
res = int(sys.argv[4]) if len(sys.argv) > 4 else 700
views = (sys.argv[5] if len(sys.argv) > 5 else 'front,q34,profile').split(',')
DIST = float(sys.argv[6]) if len(sys.argv) > 6 else 1.15
d = np.load(src); V = d['V'].astype(np.float64); F = d['F'].astype(np.int64)
hf = np.load(hfp); fwd, up0, tip = hf['fwd'], hf['up'], hf['tip']
right = np.cross(fwd, up0); right /= np.linalg.norm(right); up = np.cross(right, fwd)
H = tip - fwd * 0.17
keep = np.linalg.norm(V[F].mean(1) - H, axis=1) < 0.42
F = F[keep]; used = np.unique(F); remap = -np.ones(len(V), np.int64); remap[used] = np.arange(len(used))
m = Mesh(V[used], remap[F])
sc = bu.reset_scene(); clay = bu.clay_material((0.80, 0.78, 0.74), 0.55)
bu.add_object("head", m, [clay], normals_angle=None)
bu.setup_cycles(samples=64, res=(res, res))
bu.world_color((0.55, 0.6, 0.7), 0.6)
yaw = math.radians(-140.0)
Rz = np.array([[math.cos(yaw), -math.sin(yaw), 0], [math.sin(yaw), math.cos(yaw), 0], [0, 0, 1]])
bu.add_sun(tuple(Rz @ np.array([-0.45, 0.55, 0.70])), strength=4.5)
c = H + up * 0.02 + fwd * 0.02
side = -right                                                   # the v1-v5 'side' axis (the head's +x)
for name in views:
    dvec = {'front': fwd * 0.95 + side * 0.25, 'q34': fwd * 0.7 - side * 0.7, 'profile': side * 1.0 + fwd * 0.05, 'low': fwd * 0.9 - up * 0.45 + side * 0.15}[name]
    dvec = dvec / np.linalg.norm(dvec)
    cam = bu.add_camera(tuple(c + dvec * DIST + np.array([0, 0, 0.04])), tuple(c), lens=70)
    bu.render_to(f"{out}_{name}.png")
    bpy.data.objects.remove(cam)
