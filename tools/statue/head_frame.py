"""Her head frame, for erode_statue.py: forward/up from the generator's head rotation (statue.HEAD_M) turned by the
statue's yaw on the plinth (build_geo.STATUE_YAW), and the nose tip measured on the mesh as the most protruding
point of the face (the chin and the fist both stick out further along 'forward', so a plain max picks the wrong one).
usage: python head_frame.py STATUE.npz OUT.npz"""
import math, os, sys
import numpy as np
from scipy.spatial import cKDTree
sys.path.insert(0, os.environ.get("ROTUNDA_GENERATOR", "../Colosseum/generator"))   # the procedural generator (Colosseum repo)
import statue as st

src, out = sys.argv[1:3]
V = np.load(src)['V'].astype(np.float64)
yaw = math.radians(-140.0)                                     # build_geo.STATUE_YAW
Rz = np.array([[math.cos(yaw), -math.sin(yaw), 0], [math.sin(yaw), math.cos(yaw), 0], [0, 0, 1]])
fwd, up = Rz @ st.HEAD_M @ np.array([0, 1.0, 0]), Rz @ st.HEAD_M @ np.array([0, 0, 1.0])
top = V[:, 2].max()
P = V[V[:, 2] > top - 0.40]
f = P @ fwd
front = f > np.percentile(f, 70)
tree = cKDTree(P)
prot = np.array([fi - f[tree.query_ball_point(p, 0.03)].mean() for p, fi in zip(P[front], f[front])])
tip = P[front][np.argmax(prot)]
np.savez(out, fwd=fwd, up=up, tip=tip)
print('nose tip', tip.round(4), 'forward', fwd.round(3))
