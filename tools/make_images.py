"""Build every 2D asset of the site from the project's real renders and iteration shots.

usage: python make_images.py WORK_DIR PDF_IMAGES_DIR OUT_IMG_DIR
    render/   final Cycles frames               process/  iteration shots (clay, statue heads, ivy, masonry, debug ...)
    ue/       first Unreal renders (from the PDF) sketch/   pencil, value-study, storyboard and colour-key versions
    paper/    tileable paper, grain, coffee ring
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

RNG = np.random.default_rng(13)


def load(path, bg=(14, 18, 15)):
    im = Image.open(path)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        base = Image.new("RGBA", im.size, bg + (255,))
        im = Image.alpha_composite(base, im)
    return im.convert("RGB")


def save_jpg(im, dst, long_side=1600, q=82):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if long_side and max(im.size) > long_side:
        s = long_side / max(im.size)
        im = im.resize((round(im.size[0] * s), round(im.size[1] * s)), Image.LANCZOS)
    im.save(dst, "JPEG", quality=q, optimize=True, progressive=True)
    return im


# ------------------------------------------------------------------------------------------------ paper
def tile_noise(n, beta, seed):
    r = np.random.default_rng(seed)
    f = np.fft.fftfreq(n)
    fx, fy = np.meshgrid(f, f)
    rad = np.sqrt(fx ** 2 + fy ** 2)
    rad[0, 0] = 1.0
    spec = (r.standard_normal((n, n)) + 1j * r.standard_normal((n, n))) / rad ** beta
    spec[0, 0] = 0
    x = np.real(np.fft.ifft2(spec))
    return (x - x.mean()) / (x.std() + 1e-9)


def paper(n=1024, base=(236, 228, 212), seed=1, marble=True):
    low = tile_noise(n, 1.6, seed)
    mid = tile_noise(n, 1.0, seed + 1)
    hi = tile_noise(n, 0.3, seed + 2)
    t = 1.0 - 0.035 * low - 0.018 * mid - 0.012 * hi
    if marble:                                                     # faint marbling veins, like art-book stock
        yy, xx = np.mgrid[0:n, 0:n] / n
        warp = 3.2 * tile_noise(n, 1.8, seed + 3) + 1.6 * tile_noise(n, 1.2, seed + 4)
        v = np.abs(np.sin(2 * np.pi * (2 * xx + 1 * yy) + warp))
        t -= 0.05 * np.clip(1 - v / 0.05, 0, 1) * np.clip(0.5 + 0.5 * tile_noise(n, 1.5, seed + 5), 0, 1)
    # fibres: streaked high-frequency noise
    fib = ndi.uniform_filter1d(RNG.standard_normal((n, n)), 9, axis=1, mode="wrap")
    fib = ndi.uniform_filter1d(fib, 2, axis=0, mode="wrap")
    t -= 0.012 * np.clip(fib, 0, None)
    img = np.clip(np.array(base, np.float32)[None, None] * t[..., None], 0, 255).astype(np.uint8)
    return Image.fromarray(img)


def grain(n=256):
    g = RNG.standard_normal((n, n))
    a = np.clip(128 + 60 * g, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([a, a, a, np.full_like(a, 40)]), "RGBA")


def coffee_ring(n=640, seed=4):
    r = np.random.default_rng(seed)
    yy, xx = (np.mgrid[0:n, 0:n] - n / 2) / (n / 2)
    rad = np.hypot(xx, yy)
    th = np.arctan2(yy, xx)
    wob = sum(r.uniform(0.004, 0.02) * np.sin(k * th + r.uniform(0, 6.3)) for k in range(2, 9))
    r0 = 0.78 + wob
    ring = np.exp(-((rad - r0) / 0.018) ** 2) * (0.55 + 0.45 * np.cos(th * 1.0 + 1.0) ** 2)
    inner = np.clip(1 - rad / r0, 0, 1) ** 0.5 * 0.18 * (rad < r0)
    gap = np.clip((np.cos(th - 2.2) - 0.86) * 9, 0, 1)
    a = np.clip((ring + inner) * (1 - gap), 0, 1) * 0.22
    col = np.zeros((n, n, 4), np.uint8)
    col[..., 0], col[..., 1], col[..., 2] = 122, 84, 46
    col[..., 3] = (a * 255).astype(np.uint8)
    return Image.fromarray(col, "RGBA")


# ------------------------------------------------------------------------------------------------ graphite
def _norm_lum(rgb, lo=1.5, hi=99.0, gamma=0.75):
    g = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    a, b = np.percentile(g, lo), np.percentile(g, hi)
    return np.clip((g - a) / max(b - a, 1e-3), 0, 1) ** gamma


def _streaks(h, w, angle, length, seed):
    """Pencil streak texture: noise smeared along one direction (line-integral style)."""
    r = np.random.default_rng(seed)
    d = int(np.hypot(h, w)) + 8
    n = r.random((d, d)).astype(np.float32)
    n = (n > 0.9).astype(np.float32) * r.uniform(0.6, 1.0, (d, d)).astype(np.float32)
    im = Image.fromarray((n * 255).astype(np.uint8)).rotate(angle, resample=Image.BILINEAR)
    a = np.asarray(im, np.float32) / 255
    a = ndi.uniform_filter1d(a, length, axis=1)
    im = Image.fromarray(np.clip(a * 255 * 5.0, 0, 255).astype(np.uint8)).rotate(-angle, resample=Image.BILINEAR)
    a = np.asarray(im, np.float32) / 255
    oy, ox = (d - h) // 2, (d - w) // 2
    a = a[oy:oy + h, ox:ox + w]
    return (a - a.min()) / (a.max() - a.min() + 1e-6)


def graphite(img, pap, line=1.0, hatch=1.0, tone=0.55, scale=1.0, seed=0, ink=(40, 36, 33), gamma=0.75):
    rgb = np.asarray(img, np.float32) / 255
    h, w = rgb.shape[:2]
    g = _norm_lum(rgb, gamma=gamma)
    gs = ndi.gaussian_filter(g, 1.0 * scale)
    # contour lines: difference of gaussians at two scales + colour-dodge sketch
    dog = ndi.gaussian_filter(g, 0.8 * scale) - ndi.gaussian_filter(g, 2.6 * scale)
    lines = np.clip(1 - 7.5 * np.abs(dog) * line, 0, 1)
    inv_blur = ndi.gaussian_filter(1 - g, 7 * scale)
    dodge = np.clip(gs / np.maximum(1 - inv_blur, 1e-3), 0, 1)
    dodge = np.clip((dodge - 0.25) / 0.75, 0, 1) ** 1.6
    # tonal hatching: two stroke directions, the second only in the darks
    t = ndi.gaussian_filter(g, 3.0 * scale)
    s1 = _streaks(h, w, 38 + seed % 7, int(34 * scale), seed + 1)
    s2 = _streaks(h, w, -52 + seed % 5, int(28 * scale), seed + 2)
    d1 = np.clip((s1 - t * 1.05) * 3.0, 0, 1) * hatch
    d2 = np.clip((s2 - t * 1.6 - 0.08) * 3.0, 0, 1) * hatch
    dark = 1 - (1 - (1 - lines)) * (1 - d1 * 0.55) * (1 - d2 * 0.45) * (1 - (1 - dodge) * 0.55)
    dark = np.clip(dark + (1 - t) * tone * 0.22, 0, 1)
    # paper tooth: graphite catches only the paper's high points
    tooth = tile_noise(max(h, w) if max(h, w) <= 2048 else 2048, 0.2, seed + 9)[:h, :w]
    dark *= np.clip(0.82 + 0.25 * tooth, 0.5, 1.1)
    pap = np.asarray(pap.resize((w, h)) if pap.size != (w, h) else pap, np.float32)
    ink = np.array(ink, np.float32)
    out = pap * (1 - dark[..., None]) + ink * dark[..., None]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def value_study(img, pap, levels=(0.12, 0.34, 0.6, 0.86), seed=0):
    rgb = np.asarray(img, np.float32) / 255
    g = _norm_lum(rgb, gamma=0.9)
    g = ndi.median_filter(g, size=7)
    g = ndi.gaussian_filter(g, 1.2)
    q = np.digitize(g, [0.22, 0.45, 0.7])
    vals = np.array(levels, np.float32)[q]
    # marker edges: slight bleed + streak
    vals = ndi.gaussian_filter(vals, 0.8)
    st = _streaks(*g.shape, 90, 30, seed + 5)
    vals = np.clip(vals + (st - 0.5) * 0.05, 0, 1)
    pap = np.asarray(pap.resize(img.size), np.float32)
    tint = np.array([0.98, 0.97, 0.95], np.float32)
    out = pap * (vals[..., None] * tint)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def colour_key(img, w=360):
    small = img.resize((48, max(1, round(48 * img.size[1] / img.size[0]))), Image.BOX)
    q = small.quantize(7, method=Image.MEDIANCUT).convert("RGB")
    big = q.resize((w, round(w * img.size[1] / img.size[0])), Image.NEAREST).filter(ImageFilter.GaussianBlur(3.5))
    a = np.asarray(big, np.float32)
    a = 128 + (a - 128) * 1.12
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def main(work, pdfx, out):
    os.makedirs(out, exist_ok=True)
    P = lambda *p: os.path.join(work, *p)
    pap = paper(1024, seed=1)
    os.makedirs(f"{out}/paper", exist_ok=True)
    pap.save(f"{out}/paper/paper.jpg", quality=86, optimize=True, progressive=True)
    paper(1024, base=(214, 206, 190), seed=11, marble=False).save(f"{out}/paper/paper_dark.jpg", quality=86, optimize=True)
    grain().save(f"{out}/paper/grain.png", optimize=True)
    coffee_ring().save(f"{out}/paper/coffee.png", optimize=True)

    # final frames
    final = {"hero": "prev_final3/Cam_Hero.png", "statue": "prev_final3/Cam_Statue.png", "dome": "prev_final3/Cam_Dome.png",
             "reel": "prev_final3/Cam_Reel.png", "wide": "prev_final3/Cam_Wide.png", "above": "prev_final2/Cam_Above.png",
             "ivyarch": "prev_final2/Detail_IvyArch.png", "ledge": "prev_final2/Detail_Ledge.png",
             "waterline": "prev_final2/Detail_Waterline.png"}
    imgs = {}
    for k, v in final.items():
        imgs[k] = load(P(v))
        save_jpg(imgs[k], f"{out}/render/{k}.jpg", 1600, 84)

    # iteration shots (real files from the build, renamed for the page)
    proc = {"toolkit": "t_toolkit.png", "bay_clay": "t_bay.png", "bay_clay_high": "t_bay2_high.png", "bay_clay_wide": "t_bay2_wide.png",
            "first_tex_a": "t_close_a.png", "first_tex_b": "t_close_b.png", "lib": "t_lib.png",
            "statue_v0_front": "t_statue_front.png", "statue_v0_back": "t_statue_back.png", "statue_v0_head": "t_statue_head.png",
            "statue_v0_head2": "t_statue2_head.png", "statue_v0_side": "t_statue_left_side.png",
            "scene_v0_wide": "t_v_wide.png", "scene_v0_mid": "t_v_mid.png", "scene_v0_hero": "t_v_hero.png", "scene_v0_mid34": "t_v_mid34.png",
            "tex_sheet": "tex_sheet.png", "tex_sheet2": "sheet_tex2.jpg",
            "wc_wall": "wc_wall.png", "wc_arch": "wc_arch.png", "wc_base": "wc_base.png", "wc3_arch": "wc3_arch.png", "wc3_wall": "wc3_wall.png",
            "m1_wall": "m1_wall.png", "m1_col": "m1_col.png", "m2_cl": "m2_cl.png", "m2_cl2": "m2_cl2.png",
            "ashlar_check": "ashlar_align_check.jpg", "ashlar_crop": "crop_ashlar.jpg", "moss_crop": "crop_moss.jpg",
            "ivy_cards": "ivyA_ivy.png", "ivy_cards2": "ivyA_ivy2.png", "ivymat": "ivymat2_prev.jpg", "propivy_up": "propivy1_up.png",
            "propivy_pool": "propivy1_pool.png", "leaf_old": "leaf3d_cell0.jpg", "leaf_new": "leafv3_cell.jpg", "leaf_strip": "leafv3_test.jpg",
            "leaf_atlas": "leaf3d_atlas_small.jpg", "litter_atlas": "litter3d_atlas_small.jpg",
            "hp_wall_v9": "hp_wall_v9.png", "hp_wall_v10": "hp_wall_v10.png", "hp_wall_v11": "hp_wall_v11.png",
            "hp_ledge_v9": "hp_ledge_v9.png", "hp_ledge_v10": "hp_ledge_v10.png", "hp_base_v9": "hp_base_v9.png", "hp_base_v10": "hp_base_v10.png",
            "f1_hi": "f1_hi.png", "f1_wide": "f1_wide.png", "d3_wide": "d3_wide.jpg", "cmp_hero": "cmp_hero.jpg",
            "dbg_nowater": "dbg_nowater.png", "dbg_nofog": "dbg_nofog.png", "dbg_instonly": "dbg_instonly.png", "dbg_stems": "dbg_stems.png",
            "dbg_nofoam": "dbg_nofoam.png", "foam_mask": "foam_mask_prev.png",
            "light_a": "L1_mid_A.png", "light_b": "L1_mid_B.png", "light_c": "L1_mid_C.png", "light_d": "L2_mid_D.png", "light_e": "L2_mid_E.png",
            "light_f": "L2_mid_F.png", "light_g": "L3_mid_G.png", "light_h": "L3_mid_H.png", "light_i": "L3_mid_I.png",
            "light_j": "L4_mid_J.png", "light_k": "L4_mid_K.png", "light_l": "L4_mid_L.png", "light_m": "L5_reel_M.png", "light_n": "L5_reel_N.png"}
    for i in range(1, 6):
        for v in ("front", "q34", "profile"):
            proc[f"head_v{i}_{v}"] = f"head_v{i}_{v}.png"
    for i in range(4):
        for v in ("front", "q34", "side", "back", "cascade"):
            if os.path.exists(P(f"body_b{i}_{v}.png")):
                proc[f"body_b{i}_{v}"] = f"body_b{i}_{v}.png"
    for k, v in proc.items():
        if os.path.exists(P(v)):
            im = load(P(v), bg=(160, 166, 174))
            if k.startswith(("head_", "body_")):
                im = load(P(v), bg=(158, 164, 172))
            save_jpg(im, f"{out}/process/{k}.jpg", 1400, 82)
        else:
            print("missing", v)
    evo = ["prev_final", "prev_d1", "prev_d2", "prev_d3a", "prev_d4", "prev10d", "prev11d", "prev_hp", "prev_final2", "prev_final3"]
    for i, d in enumerate(evo):
        save_jpg(load(P(d, "Cam_Hero.png")), f"{out}/process/evo_{i:02d}.jpg", 900, 80)

    # first Unreal renders (Sumanth's, from the PDF)
    ue = ["p01_0", "p11_0", "p11_1", "p13_0", "p14_0", "p14_1", "p15_0", "p15_1", "p16_0", "p16_1", "p17_0", "p17_1", "p18_1",
          "p19_0", "p19_1", "p20_0", "p20_1", "p21_0"]
    for i, n in enumerate(ue):
        save_jpg(load(os.path.join(pdfx, n + ".jpeg")), f"{out}/ue/ue_{i:02d}.jpg", 1600, 82)

    # concept versions
    sk = {"hero": 1.0, "wide": 1.0, "dome": 1.0, "statue": 1.0, "reel": 1.0, "ivyarch": 1.0, "above": 1.0, "ledge": 1.0, "waterline": 1.0}
    for i, k in enumerate(sk):
        im = imgs[k]
        im = im.resize((round(im.size[0] * 1200 / max(im.size)), round(im.size[1] * 1200 / max(im.size))), Image.LANCZOS)
        save_jpg(graphite(im, pap, seed=i * 7, gamma=0.5, tone=0.35), f"{out}/sketch/pencil_{k}.jpg", 1200, 84)
        save_jpg(value_study(im, pap, seed=i), f"{out}/sketch/value_{k}.jpg", 1200, 84)
        save_jpg(colour_key(im), f"{out}/sketch/key_{k}.jpg", 400, 86)
    for k in ("bay_clay_wide", "bay_clay_high", "head_v5_front", "head_v1_front", "body_b3_front", "toolkit", "scene_v0_wide"):
        src = P(proc[k])
        im = load(src, bg=(200, 200, 200))
        save_jpg(graphite(im, pap, line=1.3, hatch=0.8, seed=31), f"{out}/sketch/pencil_{k}.jpg", 1200, 84)
    for i, k in enumerate("abcdefghijklmn"):
        src = P(proc[f"light_{k}"])
        save_jpg(colour_key(load(src)), f"{out}/sketch/key_light_{k}.jpg", 400, 86)
    # storyboard: "the Night of Bells" (marker + graphite, heavy)
    story = ["bay_clay_wide", "dome", "statue", "wide", "waterline", "ivyarch"]
    for i, k in enumerate(story):
        im = imgs[k] if k in imgs else load(P(proc[k]), bg=(200, 200, 200))
        im = im.resize((round(im.size[0] * 900 / max(im.size)), round(im.size[1] * 900 / max(im.size))), Image.LANCZOS)
        v = value_study(im, pap, levels=(0.08, 0.3, 0.58, 0.9), seed=40 + i)
        g = graphite(im, Image.fromarray(np.asarray(v)), line=1.4, hatch=0.7, tone=0.2, seed=50 + i)
        save_jpg(g, f"{out}/sketch/story_{i}.jpg", 900, 84)
    tot = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(out) for f in fs)
    print(f"images: {tot / 1e6:.1f} MB")


if __name__ == "__main__":
    main(*sys.argv[1:4])
