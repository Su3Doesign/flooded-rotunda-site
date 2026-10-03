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
| p.1 | Prologue | | how it started; colour keys; plan sketch |
| I | The Spring | `plan` | top-down plan cut at +2.6 m (red = solid stone, like an architect's poché), half-sketched, over its own drawing |
| II | Twelve Bays | `bays` | the walls build up around the camera and the dome closes over it; anchored callouts |
| p.2 | Making the stones | | toolkit → clay → masonry joints → v9/v10/v11 |
| III | The Night of Bells | `dome` | looking up: 17 light shafts, dust |
| p.3 | Storyboard | | six panels, lighting keys, ten versions of the hero frame |
| IV | La Custode | `statue` | her inscription: *AQVAM • TENEO • DONEC • REDEAS* |
| p.4 | Five faces | | head v1–v5, body b0–b3 |
| V | Green Water | `water` | skimming the surface: foam, caustics |
| VI | What Grows | `ivy` | 3D ivy close-up, live counters |
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
js/drawings.js      the hand-drafted plan and bay section (SVG)
assets/             the web export of the Blender world (see below)
img/                renders, iteration shots, first Unreal frames, sketches, paper
tools/make_images.py  builds img/ (pencil, value-study, storyboard and colour-key versions)
vendor/             three.js r186 · GSAP 3.15 + ScrollTrigger · Lenis 1.3
fonts/              Cinzel, Cormorant Garamond, Caveat, Reenie Beanie, Space Grotesk (SIL OFL)
```

**The world** (`assets/`, ~25 MB) is produced from the procedural Flooded Rotunda generator by `generator/site_export.py`:

- `statue.glb`: her 1.2 M-triangle SDF mesh, decimated to 120 k, plus her ivy. She loads first because she is the loading screen.
- `world.glb`: 12 arcade bays, dome, ribs, rubble, platform, pedestal and floor, plus thick ivy trunks. 580 k triangles, Draco-compressed.
- `library.glb`: low-poly instance meshes: 8 ivy leaves, 6 dead leaves, 4 ferns, 4 grass clumps, 4 moss cushions and 12 pebbles.
- `inst/*.bin`: 110,891 instance records (`x y z qx qy qz qw sx sy sz tint`, float32, shuffled so a prefix is a uniform sample, which lets the quality tiers draw the first *N*).
- `tex/`: the procedural stone, moss, marble, paving, leaf, water and caustics maps.
- `scene.json`: sun direction, the 16 dome holes and the oculus (light shafts), camera keys and file sizes for the loader.

UV0 is the stone projection. UV1 = (moss, grime) and UV2 = (waterline, random) are recomputed with the same generator functions and seeds as the Unreal and Blender builds, so the web materials read the same masks. The stone shader height-blends moss into the stone, darkens grime, wets and algae-tints the waterline, and adds caustics below it. In the plan view the model is cut with a clipping plane and back faces turn solid red, so the section shows its walls the way an architect's poché does. The dome is "lifted" with a noise dissolve in its own material, so it disappears from view but still casts its shadow into the room.

**Sketchbook touches.** Between two camera stops the world half-dissolves into a pencil sketch and resolves again on arrival, as if the drawing were being redrawn while you travel. Red-pencil circles, arrows and underlines (`js/marks.js`) are generated from each element's size and drawn in when they scroll into view. The loading indicator is the emblem itself: a ring that draws itself while its twelve ticks, the twelve bays, light up.

**Sound** (`js/sound.js`, off until you press ♪). Everything is synthesized in the browser, with no audio files: a stone-room reverb, a slow room tone, drips echoing under the dome, cast-bronze bell tolls when you enter *The Night of Bells*, and a low swell each time the water rises a finger.

**Concept pass.** Everything renders into an HDR target and then through one post shader. That shader can turn the frame into a pencil drawing on cream paper or into chalk on black paper. The drawing uses depth and luminance edges plus tonal hatching, and its lines "boil" at 8 fps like hand-drawn animation. A noise dissolve moves between sketch and render. The ✎ button in the corner turns the whole world into a sketch at any time.

**Lighting.** One sun with a static 4096² shadow map, so the dome's shadow is baked once and the light reaches the floor only through its holes. There is no real global illumination: an environment map captured from the middle of the room itself stands in for one bounce. Bloom, grain and vignette sit on top.

## Hosting

This is a static site: any static host works.

- **GitHub Pages**: Settings → Pages → *Deploy from a branch* → `main` / root. Pages on a **private** repository needs a paid GitHub plan (Pro, Team or Enterprise). On the free plan, make the repository public or use another host.
- **Netlify / Cloudflare Pages / Vercel**: drag and drop the folder, or point them at the repository. There's no build command and the output directory is the root.

Total transfer is about 45 MB (world 25 MB, images 17 MB). The images are lazy-loaded, so the first view needs only the statue (2.4 MB) and the code.

## Credits

Inspired by a reel by **simonzhang.art**. Every model, texture, render and sketch on this site was made for this project. Fonts are under the SIL Open Font License. three.js and Lenis are MIT. GSAP is under its standard no-charge license.
