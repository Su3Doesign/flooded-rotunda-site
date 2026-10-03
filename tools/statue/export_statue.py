"""Re-export only the statue for the site from the weathered mesh (same recipe as site_export.export_world)."""
import json, os, sys
sys.path.insert(0, os.environ.get("ROTUNDA_GENERATOR", "../Colosseum/generator"))   # the procedural generator (Colosseum repo)
import numpy as np
import site_export as se
import blender_util as bu
import weather as wx
from meshkit import Mesh

src, geo, site = sys.argv[1:4]
bu.reset_scene()
m = Mesh.load(src)
d = se.decimate(m, 140000)
d.uv_box(2.0, only_missing=False)
top = float(d.V[:, 2].max())
# an old statue keeps a little lichen in her crevices: clean the head less than before (0.80 -> 0.55)
wx.compute_masks(d, seed=503, moss_bias=-0.40, clean_above=(top - 0.62, top - 0.18, 0.55))
d.mat[:] = 4
objs = [se.add("statue", d, smooth=True)]
stems = f"{geo}/ivy_stems_statue.npz"
if os.path.exists(stems):
    sv = se.decimate(Mesh.load(stems), 6000)
    sv.mat[:] = 6
    sv.uv_box(0.6, only_missing=False)
    objs.append(se.add("statue_ivy", sv, smooth=True))
out = f"{site}/assets/statue.glb"
se.export_glb(out, objs)
sc = json.load(open(f"{site}/assets/scene.json"))
sc["files"]["statue.glb"] = os.path.getsize(out)
sc["statue_top"] = top
sc["statue_head"] = [0.0, top - 0.25, -0.0]
json.dump(sc, open(f"{site}/assets/scene.json", "w"), indent=1)
print("statue tris", d.nf, "top", round(top, 4), "bytes", os.path.getsize(out))
