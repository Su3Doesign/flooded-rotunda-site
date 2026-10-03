"""Line drawings of the real geometry for the site's book pages (Blender Freestyle, Cycles CPU).
  plan : orthographic, looking down, cut at +2.6 m (the camera's near plane is the knife); back faces = poché
  bay  : orthographic elevation of one bay (bay 0, between the clusters at 0 and 30 degrees), from inside the ring
usage: python render_drawings.py GEO9 GEO10 OUTDIR [plan|bay|both] [res]"""
import math, sys, time
import numpy as np
import bpy

GEO9, GEO10, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
WHICH = sys.argv[4] if len(sys.argv) > 4 else 'both'
RES = int(sys.argv[5]) if len(sys.argv) > 5 else 1600
GRAPHITE = (0.231, 0.216, 0.192)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 12
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 0
    sc.cycles.transparent_max_bounces = 16
    sc.render.film_transparent = True
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.world = bpy.data.worlds.new('w')
    sc.world.color = (1, 1, 1)
    return sc


def load(path, keep=None, name=None, weld=False):
    d = np.load(path)
    V, F = d['V'].astype(np.float64), d['F'].astype(np.int64)
    F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]          # drop degenerate triangles
    if keep is not None:
        F = F[keep(V[F])]
        used = np.unique(F)
        remap = -np.ones(len(V), np.int64); remap[used] = np.arange(len(used))
        V, F = V[used], remap[F]
    me = bpy.data.meshes.new(name or path.split('/')[-1])
    me.vertices.add(len(V)); me.vertices.foreach_set('co', V.astype(np.float32).ravel())
    me.loops.add(F.size); me.loops.foreach_set('vertex_index', F.astype(np.int32).ravel())
    me.polygons.add(len(F)); me.polygons.foreach_set('loop_start', (np.arange(len(F)) * 3).astype(np.int32))
    me.polygons.foreach_set('use_smooth', np.ones(len(F), bool))
    me.update(calc_edges=True)
    if weld:                                                    # revolve seams would be drawn as edges; blocks keep their outlines
        import bmesh
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-4)
        bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(me.name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob, len(F)


def flat_material(poche_rgba=None):
    """Every face is a holdout: it hides what is behind it but leaves the paper showing (alpha 0); only lines are drawn.
    (The poché is drawn as vector fills from the exact section, not here.)"""
    m = bpy.data.materials.new('flat')
    m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tr = nt.nodes.new('ShaderNodeHoldout')
    if poche_rgba is None:
        nt.links.new(tr.outputs[0], out.inputs[0])
        return m
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs[0].default_value = poche_rgba; em.inputs[1].default_value = 1.0
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(geo.outputs['Backfacing'], mix.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    return m


def linestyle(name, thick, alpha=1.0, noise=0.0, seed=1):
    # graphite: slightly unsteady, tapering at both ends
    ls = bpy.data.linestyles.new(name)
    ls.color = GRAPHITE
    ls.thickness = thick
    ls.alpha = alpha
    ls.thickness_position = 'CENTER'
    ls.use_chaining = True
    ls.chaining = 'PLAIN'
    ls.use_same_object = True
    if noise > 0:
        g = ls.geometry_modifiers.new('wobble', 'PERLIN_NOISE_1D')
        g.frequency = 9.0; g.amplitude = noise; g.seed = seed; g.octaves = 2
    t = ls.thickness_modifiers.new('taper', 'ALONG_STROKE')
    t.blend = 'MULTIPLY'; t.mapping = 'CURVE'
    c = t.curve.curves[0]
    c.points[0].location = (0.0, 0.45); c.points[1].location = (1.0, 0.45)
    c.points.new(0.12, 1.0); c.points.new(0.88, 1.0)
    t.curve.update()
    return ls


def freestyle(sc, sets):
    sc.render.use_freestyle = True
    sc.render.line_thickness_mode = 'ABSOLUTE'
    vl = sc.view_layers[0]
    fs = vl.freestyle_settings
    fs.crease_angle = math.radians(128)
    fs.use_culling = True
    fs.use_smoothness = True
    fs.as_render_pass = False
    for ls in list(fs.linesets): fs.linesets.remove(ls)
    for name, edges, style in sets:
        s = fs.linesets.new(name)
        s.select_by_visibility = True; s.visibility = 'VISIBLE'
        s.select_by_edge_types = True
        for e in ('silhouette', 'border', 'crease', 'contour', 'external_contour', 'material_boundary', 'suggestive_contour', 'ridge_valley', 'edge_mark'):
            setattr(s, 'select_' + e, e in edges)
        s.linestyle = style


def ortho_camera(sc, loc, rot, scale, res_x, res_y, clip=(0.001, 100)):
    cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.ortho_scale = scale
    cam.clip_start, cam.clip_end = clip
    ob = bpy.data.objects.new('cam', cam); sc.collection.objects.link(ob)
    ob.location = loc; ob.rotation_euler = rot
    sc.camera = ob
    sc.render.resolution_x, sc.render.resolution_y = res_x, res_y
    sc.render.resolution_percentage = 100
    return ob


def plan():
    sc = reset()
    Z = 2.6
    below = lambda T: T[:, :, 2].min(axis=1) < Z + 0.05
    n = 0
    mat = flat_material(None)
    for i in range(12):
        ob, k = load(f'{GEO9}/arcade_bay_{i:02d}.npz', below); ob.data.materials.append(mat); n += k
    for nm in ('floor', 'platform', 'pedestal'):
        ob, k = load(f'{GEO10}/{nm}.npz', below, weld=True); ob.data.materials.append(mat); n += k
    ob, k = load(f'{GEO10}/statue.npz', below, 'statue'); ob.data.materials.append(mat); n += k
    print('plan faces', n, flush=True)
    S = 29.0
    ortho_camera(sc, (0, 0, Z), (0, 0, 0), S, RES, RES, clip=(0.0005, 12))
    k = RES / 1600
    freestyle(sc, [('outline', ('silhouette', 'border', 'external_contour'), linestyle('outline', k * 3.4, 0.95, k * 0.6, 3)),
                   ('detail', ('crease',), linestyle('detail', k * 2.2, 0.8, k * 0.5, 5))])
    sc.render.filepath = f'{OUT}/plan.png'
    t = time.time(); bpy.ops.render.render(write_still=True); print('plan rendered', round(time.time() - t, 1), 's', flush=True)


def bay():
    sc = reset()
    a = math.radians(15.0)
    d = np.array([math.cos(a), math.sin(a)])
    R0 = 5.4                                                   # camera plane: inside the ring, in front of the platform
    keep = lambda T: ((T[:, :, :2] @ d).max(axis=1) > R0 - 0.1) & (np.abs(T[:, :, :2] @ np.array([-d[1], d[0]])).min(axis=1) < 4.6)
    n = 0
    mat = flat_material(None)
    for i in (11, 0, 1):
        ob, k = load(f'{GEO9}/arcade_bay_{i:02d}.npz', keep); ob.data.materials.append(mat); n += k
    ob, k = load(f'{GEO10}/floor.npz', keep, weld=True); ob.data.materials.append(mat); n += k
    print('bay faces', n, flush=True)
    W, H = 7.6, 18.4                                           # metres across / up: floor (-1.1) to above the parapet (16.05)
    zc = (-1.6 + 16.8) / 2
    rx = int(RES * W / H * 1.0) // 2 * 2
    # camera looks outward along d; Blender camera looks down its -Z, so rotate: x-rot 90 deg, then yaw
    ortho_camera(sc, (R0 * d[0], R0 * d[1], zc), (math.radians(90), 0, a - math.radians(90)), H, rx, RES, clip=(0.001, 20))
    sc.render.pixel_aspect_x = 1.0
    k = RES / 1600
    freestyle(sc, [('outline', ('silhouette', 'border', 'external_contour'), linestyle('outline', k * 3.0, 0.95, k * 0.5, 7)),
                   ('detail', ('crease',), linestyle('detail', k * 1.7, 0.72, k * 0.4, 9))])
    sc.render.filepath = f'{OUT}/bay.png'
    t = time.time(); bpy.ops.render.render(write_still=True); print('bay rendered', round(time.time() - t, 1), 's', flush=True)


if WHICH in ('plan', 'both'): plan()
if WHICH in ('bay', 'both'): bay()
