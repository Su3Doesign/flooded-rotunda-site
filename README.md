# The Flooded Rotunda — a world-building sketchbook

*by Sumanth · 2026*

A long-scroll website that tells the story of the Flooded Rotunda, a drowned Romanesque ring of twelve bays with a marble keeper in the middle. You read it inside the live 3D world it was built as. The real scene (exported from the Blender/Unreal build) streams into the browser, and the camera travels through it while the book's pages (lore, storyboards, iterations and everything that broke) slide over it.

> **She turns to face whoever comes in.** That is the rule of the place, and it is why the statue is the loading screen. While the world downloads she turns on her plinth, drawn in chalk, looking for whoever just arrived. When it has loaded she stops, turns to face you, and the drawing dissolves into the rendered room. Chapter VII explains why the door says NO ENTRY.

## Run it

The page uses ES modules, so it has to be served over HTTP. Opening the file directly won't work.

```bash
cd rotunda-site
python3 -m http.server 8000
# open http://localhost:8000
```

There's no build step. Everything, including three.js, GSAP, Lenis and the fonts, is vendored.

### URL switches

| switch | what it does |
|---|---|
| `?q=low` / `medium` / `high` | force a quality tier. By default the tier is picked from the GPU and steps down automatically if frames stay slow |
| `?skip` | skip the intro sequence |
| `?at=s-water` | jump to a section once loaded (any section `id`). `&off=0.5` sets how far into it |
| `?debug` | fps, quality tier and current camera station |

## The tour

| | section | camera station | what happens |
|---|---|---|---|
| — | intro | `reveal` | she turns to face you; the title slides in |
| — | the ring | `hero` | the camera rises through the oculus and the dome dissolves like a lid lifting off (it still casts its shadow); the ring seen from above |
| p.1 | Prologue | | how it started; colour keys; the plan at +2.6 m, traced from the model |
| I | The Spring | `plan` | top-down plan cut at +2.6 m (red = solid stone, like an architect's poché), half-sketched, over its own drawing; the text sits on a taped paper card |
| II | Twelve Bays | `bays` | the walls build up around the camera and the dome closes over it; anchored callouts |
| p.2 | Making the stones | | the elevation of bay I, traced from the model; toolkit → clay → masonry joints → v9/v10/v11 |
| III | The Night of Bells | `dome` | looking up: 17 light shafts, dust |
| p.3 | Storyboard | | six panels, lighting keys, ten versions of the hero frame |
| IV | La Custode | `statue` | her inscription: *AQVAM • TENEO • DONEC • REDEAS*; nobody knows when she was carved |
| p.4 | Six faces | | head v1–v6 (v6: weathered), body b0–b3 |
| V | Green Water | `water` | skimming the surface: foam, caustics |
| VI | What Grows | `ivy` | the oculus's pool of sun on bay XII: sunlit masonry, moss and 3D ivy; live counters |
| p.5 | Sticks, then leaves | | the alpha-card problem and the fix |
| VII | No Entry — why? | `door` | from the door, through the planks; the rule, one sentence at a time |
| p.6 | What broke | | six hurdles plus a strip of first-light Unreal frames |
| — | Breakdown | `breakdown` | scroll scrubs clay → masks → light → final |
| p.7 | Plates | | final Cycles frames and studies (click to enlarge) |
| — | Epilogue | `finale` | out through the oculus; the whole building, the water a little higher |

The water gauge on the right is the keepers' tide staff. It rises with your scroll, and every chapter you enter raises the water one finger, in the world too.

## How it is made

```
index.html          the book: every chapter, caption and note
css/style.css       design system: night chapters, paper pages, hand notes, HUD
js/world.js         three.js world: loading, materials, foliage instancing, water, shafts, dust, post
js/tour.js          camera stations + scroll → camera (Hermite paths through waypoints)
js/main.js          loader story, intro, scroll orchestration, annotations, gauge, reveals
js/marks.js         red-pencil circles, arrows (note → thing) and underlines, sized from the page, kept on screen
assets/             the web export of the Blender world (see below)
img/                renders, iteration shots, first Unreal frames, sketches, paper
img/drawings/       line renders of the real geometry for the plan and the bay elevation (the labels are inline SVG)
tools/make_images.py  builds img/ (pencil, value-study, storyboard and colour-key versions)
tools/drawings/     plan + elevation: Freestyle line renders, the exact +2.6 m section (trimesh), SVG sheets
tools/statue/       her weathering pass, the v6 head renders and study, and the statue.glb re-export
tools/check/        layout audit (overflow, overlapping text, label placement) and a smoke test, with Playwright
vendor/             three.js r186 · GSAP 3.15 + ScrollTrigger · Lenis 1.3
fonts/              Cinzel, Cormorant Garamond, Caveat, Reenie Beanie, Space Grotesk (SIL OFL)
```

**The world** (`assets/`, ~25 MB) is produced from the procedural Flooded Rotunda generator by `generator/site_export.py`:

- `statue.glb`: her 1.2 M-triangle SDF mesh after the weathering pass (eyes and lips worn to soft hollows, the nose broken off at the bridge, a crack across the brow, rain channels, chips and pitting: `tools/statue/erode_statue.py`), decimated to 140 k, plus her ivy. She loads first because she is the loading screen.
- `world.glb`: 12 arcade bays, dome, ribs, rubble, platform, pedestal and floor, plus thick ivy trunks. 580 k triangles, Draco-compressed.
- `library.glb`: low-poly instance meshes: 8 ivy leaves, 6 dead leaves, 4 ferns, 4 grass clumps, 4 moss cushions and 12 pebbles.
- `inst/*.bin`: 110,891 instance records (`x y z qx qy qz qw sx sy sz tint`, float32, shuffled so a prefix is a uniform sample, which lets the quality tiers draw the first *N*).
- `tex/`: the procedural stone, moss, marble, paving, leaf, water and caustics maps.
- `scene.json`: sun direction, the 16 dome holes and the oculus (light shafts), camera keys and file sizes for the loader.

UV0 is the stone projection. UV1 = (moss, grime) and UV2 = (waterline, random) are recomputed with the same generator functions and seeds as the Unreal and Blender builds, so the web materials read the same masks. The stone shader height-blends moss into the stone, darkens grime, wets and algae-tints the waterline, and adds caustics below it. In the plan view the model is cut with a clipping plane and back faces turn solid red, so the section shows its walls the way an architect's poché does. The dome is "lifted" with a noise dissolve in its own material, so it disappears from view but still casts its shadow into the room.

**Sketchbook touches.** Between two camera stops the world half-dissolves into a pencil sketch and resolves again on arrival, as if the drawing were being redrawn while you travel. Red-pencil circles, arrows and underlines (`js/marks.js`) are generated from each element's size and drawn in when they scroll into view. The loading indicator is the emblem itself: a ring that draws itself while its twelve ticks, the twelve bays, light up.

**Sound** (`js/sound.js`, off until you press ♪). Everything is synthesized in the browser, with no audio files: a stone-room reverb, a slow room tone, drips echoing under the dome, cast-bronze bell tolls when you enter *The Night of Bells*, and a low swell each time the water rises a finger.

**Concept pass.** Everything renders into an HDR target and then through one post shader. That shader can turn the frame into a pencil drawing on cream paper or into chalk on black paper. The drawing uses depth and luminance edges plus tonal hatching, and its lines "boil" at 8 fps like hand-drawn animation. A noise dissolve moves between sketch and render. The ✎ button in the corner turns the whole world into a sketch at any time.

**Lighting.** One sun with two static shadow maps baked once at load, one with the dome casting and one with it lifted; switching between them is a pointer swap, so no frame ever pays for a shadow pass. The light reaches the floor only through the dome's holes. Each camera station can also set the sun's strength (What Grows turns it up so the oculus's pool on the wall reads the way it did in Cycles). There is no real global illumination: an environment map captured from the middle of the room itself stands in for one bounce. Bloom, grain and vignette sit on top.

**Drawings.** The plan and the bay elevation on pages 1 and 2 are traced from the model, not drawn by hand. Blender Freestyle renders the visible edges (the plan with the camera's near plane as the knife at +2.6 m; the elevation orthographic from inside the ring); the poché is the exact section of the meshes at +2.6 m (trimesh, adjacent bays merged), and every label, leader and level mark sits at the generator's own coordinates. On phones each sheet crops to the drawing and moves its notes into a caption.

**Smoothness.** The frame loop never reads layout (everything is measured once per real resize, and a phone's toolbar sliding in and out does not count). No shader is ever recompiled mid-scroll: the clipping plane is always on (parked at +1000 m) and lights fade to zero instead of switching off. The sketch pass reads one small noise texture instead of computing noise per pixel, and skips all its work where the dissolve hasn't reached. Foliage is split into eight wedges so the half of the ring behind the camera is culled. The camera follows a softened scroll, so a flick on a touch screen becomes a glide. There are no full-screen CSS blend modes, masks or backdrop blurs over the canvas. iPads start on the medium tier, and every device steps down a tier by itself if frames stay slow.

## Hosting

This is a static site: any static host works.

- **GitHub Pages**: Settings → Pages → *Deploy from a branch* → `main` / root. Pages on a **private** repository needs a paid GitHub plan (Pro, Team or Enterprise). On the free plan, make the repository public or use another host.
- **Netlify / Cloudflare Pages / Vercel**: drag and drop the folder, or point them at the repository. There's no build command and the output directory is the root.

Total transfer is about 45 MB (world 25 MB, images 17 MB). The images are lazy-loaded, so the first view needs only the statue (2.9 MB) and the code.

## Checks

```bash
python3 -m http.server 8000 &                       # from the site folder
npm i -D playwright                                 # once
node tools/check/smoke.js                           # every section, no errors, no shader recompiles while scrolling
node tools/check/audit.js out 1366 1024 nogl        # overflow, overlapping text, drawing labels (no WebGL)
node tools/check/audit.js out 834 1194 gl           # also the 3D labels against the text, HUD and screen edges
```

## Credits

Inspired by a reel by **simonzhang.art**. Every model, texture, render and sketch on this site was made for this project. Fonts are under the SIL Open Font License. three.js and Lenis are MIT. GSAP is under its standard no-charge license.
