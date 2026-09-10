# Kitchen Environment — three.js

A cozy rustic kitchen built in Blender and baked for the web. It is the home
environment for Colin's rigged toon "mini-me" character. This repo is a standalone
web app, separate from Orb/glorp, though pieces will be borrowed from there (the
character GLB, and later the voice/viseme setup).

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts: `npm run build` (typecheck + production build into `dist/`),
`npm run preview`, `npm run typecheck`.

Open the panel in the top-right corner to tune the lighting knobs live.

## Status

**Milestone 1 — the room renders.** The baked kitchen loads from the wide
reference camera with mouse sway, matching the Blender framing. Nothing is
interactive yet.

Still to do: drop the character in (`CHARACTER_SPOT` in `src/main.ts` marks the
spot), then interactions, then voice.

## Layout

```
index.html                      loading overlay + canvas
src/main.ts                     renderer, resize, render loop, tuning panel
src/kitchenEnvironment.ts       loads the GLB, wires up lightmaps and the HDR probe
public/kitchen/                 the baked assets, served verbatim
  kitchen_room_02.glb           the room: 82 meshes, Draco + WebP
  kitchen_lightmaps.json        manifest: atlases, mesh->atlas map, exposure, interactive names
  kitchen_probe.hdr             360° HDR panorama shot from the middle of the room
  lightmaps/LM_Arch.webp        walls, floor, ceiling, beams, tile, rugs
  lightmaps/LM_Cabinetry.webp   cabinets, counters, shelves, stove, table
  lightmaps/LM_Props.webp       pottery, plants, books, jars
  lightmaps/LM_Interactive.webp the movable objects, baked at rest position
scripts/screenshot.mjs          optional headless render check (see below)
```

About 14 MB of assets. Every file is well under GitHub's limits, so Git LFS is
optional — worth revisiting if the bake gets re-exported often, since binary
history grows the repo.

### Re-exporting the room from Blender

The manifest's `glb` field names the export in use, so a new one is dropped in
and pointed at. Two exporter checkboxes matter, and `kitchen_room_02.glb` was
exported without either:

- **Include > Cameras.** Without it the GLB has no `Camera_Wide` and the loader
  falls back to `cameraFallback` in the manifest — a copy of the same transform,
  with a console warning. The framing is identical, but it is a copy that can
  drift from the .blend, so prefer shipping the real camera.
- **Include > Custom Properties.** These carry the `lightmap_atlas` tag on each
  node. Without them the loader falls back to the manifest's `meshes` map, which
  currently covers all 72 lightmapped meshes — but a mesh added later and absent
  from that map would silently render unlit.

Neither is fatal today (verified: 90 lightmapped materials, nothing with a
lightmap UV left unlit, all 13 interactive objects resolving), but ticking both
makes the GLB self-describing again.

To compare a new export against the current one without rebuilding, append
`?glb=<file>.glb` — it loads that file from `public/kitchen/` instead.

**Draco:** the GLB's geometry is Draco-compressed, but there is nothing to copy
into `public/`. Since r180 `DRACOLoader` resolves its own decoder through
`import.meta.url`, so Vite bundles the exact decoder that ships with the installed
version of three. Pass `dracoPath` to `loadKitchen` only to override that.

## How the lighting works

Read this before changing any materials or adding lights.

- **The room's lighting is baked into lightmaps.** Each lightmapped mesh has a
  second UV set (`TEXCOORD_1`). The loader assigns the right lightmap to every
  material using the `lightmap_atlas` value in the mesh's glTF extras
  (`userData.lightmap_atlas`), with the manifest as a fallback. 90 materials end
  up lightmapped.
- **Lightmap encoding.** The WebP lightmaps store `light / 8`, sRGB-encoded, so
  they fit 8-bit without clipping the window sunlight. Decode with
  `texture.colorSpace = SRGBColorSpace`, `texture.channel = 1`,
  `texture.flipY = false`, and `material.lightMapIntensity = 8 * Math.PI`. The π
  compensates for three.js dividing lightmap irradiance by π in the Lambert term.
- **Materials are cloned per mesh** before a lightmap is assigned, because one
  glTF material (for example the chair wood) can be shared by meshes that use
  different lightmap atlases.
- **Metals, glass, and glowing objects have no lightmap.** That covers chrome,
  copper, brass, all glass, the LED strip, the pendant bulb, and the outdoor
  backdrop. They are lit by the environment map only.
- **The HDR probe is `scene.environment`**, run through PMREM. It lights the
  character and provides reflections. Lightmapped materials use
  `envMapIntensity = 0.25` so they get reflections without being lit twice.
- **There are intentionally no real-time lights.** In three.js a light would also
  hit the already-lit walls and roughly double their brightness. The character is
  lit entirely by the environment map. For grounding, add a soft contact shadow or
  blob shadow under him rather than a shadow-casting light.
- **Tone mapping** is `AgXToneMapping` with exposure around 0.55, to match
  Blender's AgX view and -0.85 exposure. Output color space is sRGB.
- **Glass** gets `depthWrite = false`.

## Coordinates

Units are meters. Blender is Z-up and glTF/three.js is Y-up, so a Blender point
`(x, y, z)` becomes three.js `(x, z, -y)`.

In three.js terms:

- Floor is at `y = 0`; ceiling at `y = 3.45`.
- Back wall (stove, fridge, glass cabinet) is at `z = 0`; the room extends toward
  `+z`, about 6 m.
- Left wall (window and sink) is at `x = -3.1`; right wall (doorway, sideboard) is
  at `x = 1.53`.
- A good starting spot for the character is `(-0.3, 0, 1.7)`, standing on the rug
  in front of the stove — exported as `CHARACTER_SPOT` from `src/main.ts`. The HDR
  probe was rendered from `(-0.3, 1.1, 1.7)`, so lighting on the character is most
  accurate near there.

## Cameras

`kitchen_room_02.glb` ships no cameras, so the view currently comes from
`cameraFallback` in the manifest: position `(-0.36, 1.25, 4.9)`, no rotation,
53.13° vertical FOV, 3:2 — `Camera_Wide` from the original export, reproduced
exactly. Restoring the real cameras is one export checkbox (see above).

When the GLB does carry them, both sit as **root nodes** of the scene, and three
names the resulting object after the glTF *camera* (`Cam_Wide`, `Cam_Main`) while
keeping the node name in `userData.name`. So the loader matches on the object
name, its `userData.name`, or its parent's — matching only on the parent silently
falls through to `gltf.cameras[0]`, which is the closeup.

- **`Camera_Wide`** is the main view: a 24 mm lens, framed on a 3:2 reference image.
- **`Camera_Closeup`** is a tighter view of the stove-and-fridge wall.

`kitchen.resize(width, height)` points the camera at the viewport. Wider than 3:2
just reveals more room to the sides; narrower (a phone in portrait) widens the
vertical FOV instead, so the stove wall stays in frame rather than being cropped
away.

`addCameraSway(camera, dom, config)` returns an `update()` function to call every
frame. It adds a small mouse-follow rotation, 2.5° by default; mutate
`config.maxDeg` to change it live.

## Interactive objects

These are separate meshes, and each pivot is placed where the object naturally
moves. The loader returns them as `interactive[name]`.

| Name | Pivot | Future use |
|---|---|---|
| `Chair_Far`, `Chair_Right`, `Chair_NearLeft` | Center of the base, on the floor | Sit anchor: add an empty or bone target at seat height |
| `Fridge_Door` | Hinge edge, right side of the fridge, bottom of the upper door | Rotate about Y to open. Test which sign swings it toward the camera |
| `Fridge_Body` | Base center | Static counterpart to the door |
| `Stove_OvenDoor` | Bottom front edge of the oven | Rotate about X to drop open |
| `DutchOven_Pot`, `DutchOven_Lid` | Bottom center | Pick up / lift lid |
| `Pendant_Lamp` | Ceiling mount | Can swing; the bulb is emissive |
| `Mug_Table`, `FruitBowl`, `CopperSkillet`, `CopperSaucepan` | Near the bottom center | Pick up |

These objects' lightmaps were baked at their rest positions. When one moves far,
such as a pot carried across the room, set its `lightMap` to null and raise its
`envMapIntensity` to about 1 so it is lit by the probe like the character.

## Tuning knobs

All five are live in the top-right panel; "log settings to console" prints the
current values so they can be written back into the code or the manifest.

- **Overall brightness:** `exposure` in `kitchen_lightmaps.json` (0.55). The bake
  came out a bit brighter than Colin's Blender Eevee render, so expect to lower it
  slightly.
- **Room light strength relative to the character:** `lightMapIntensity` (8π) on
  lightmapped materials.
- **Reflections on room surfaces:** `envMapIntensity` (0.25) on lightmapped
  materials.
- **Character brightness:** his materials' `envMapIntensity`, or
  `scene.environmentIntensity`.
- **Camera sway:** degrees of mouse-follow rotation.

If the room ever looks roughly 3× too bright or too dark, the π factor is the
likely cause — try `lightMapIntensity = 8`. If the lightmaps look scrambled,
confirm `flipY = false`. If reflections look mirrored, adjust
`scene.environmentRotation`; they should be warm and bright on the window side
(`-x`).

## Live site (GitHub Pages)

`.github/workflows/pages.yml` builds the app and publishes it to GitHub Pages on
every push to `main` or a `claude/**` branch, and on manual dispatch. In the repo
settings, **Pages → Build and deployment → Source** must be set to **GitHub
Actions** (not "Deploy from a branch") — that is what lets the workflow publish.

The site is served from `https://<user>.github.io/<repo>/`, i.e. under a subpath
rather than the domain root. The workflow passes that prefix as `VITE_BASE`, Vite
rewrites the bundled asset URLs, and `src/main.ts` builds the asset path from
`import.meta.env.BASE_URL` so the GLB, HDR, and lightmaps resolve too. Local dev
stays at the root. To check a subpath build locally:

```bash
VITE_BASE=/colin/ npm run build && VITE_BASE=/colin/ npx vite preview
```

## Coincident faces

The first export had trim modelled exactly flush with the panel behind it — most
visibly the sink, where the apron's front face and its bottom rim shared a ~15 mm
band across the full 730 mm width on the plane `x = -2.46`. Both surfaces
rasterised to the same depth, so which one won was decided per pixel and shimmered
as the camera swayed. Depth precision is not the lever: this room already gets
about 0.01 mm of depth resolution at that distance from a 24-bit buffer, and these
depths were equal rather than merely close.

`kitchen_room_02.glb` fixes it in the model. Probing 2,849 rays through the sink
region: 173 hit coincident surfaces in the first export, **0** in the second.
Keep trim a hair proud of the surface behind it rather than flush.

To check for this after a re-export, the debug handles `window.kitchen` and
`window.THREE` are exposed — raycast a region and look for hits whose distances
differ by less than a few microns.

## Checking the render headlessly

`scripts/screenshot.mjs` renders the built app in headless Chromium (software
WebGL, so no GPU needed) and writes a PNG. Useful for remote sessions and
before/after comparisons when tuning.

```bash
npm i -D playwright && npx playwright install chromium   # not a project dependency
npm run build && npx vite preview --port 4173 &
npm run screenshot -- http://127.0.0.1:4173/ shot.png 1500x1000
```

## Later milestones

1. **The character.** Bring `colin_slim.glb` (and the animation GLBs) over from
   `colinwillow/glorp`. Place him at `CHARACTER_SPOT` facing `+z` toward the
   camera, play an idle animation, and add a contact shadow — not a
   shadow-casting light.
2. **Mobile GPU memory.** Download size is already handled (Draco + WebP, ~14 MB).
   WebP only shrinks the download, though: a 4K texture still takes about 64 MB of
   GPU memory once decoded, and there are several. For phones, convert textures to
   KTX2 (Basis Universal) with gltf-transform, which stays compressed on the GPU,
   and consider 2K versions of the 4K textures and lightmaps. Keep lightmaps in
   sRGB and update the manifest if their format changes.
3. **Interactions.** Sit anchors on the chairs, door hinge animations for the
   fridge and oven, pick-up targets for the pot, lid, mug, and pans, and pathing
   for the character.
4. **Light switch.** Colin can bake a second lightmap set with the lights off.
   Crossfade between the two sets in a shader, or by swapping textures while
   fading intensity, and dim the pendant bulb's emissive at the same time.
5. **Voice and visemes.** Bring over the talking-character setup from glorp: the
   Cloudflare Worker in `worker/` (Claude brain + ElevenLabs voice clone,
   `persona-colin.md`) and the viseme rig. API tokens will need reconnecting.

## Source files (Colin's machine)

`C:\Users\colin\Desktop\3D STUFF\5_ENVIRONMENTS\kitchen_room\`

- `kitchen_room.blend` — procedural master; edit design changes here.
- `kitchen_room_bake.blend` — baked textures, objects still separate.
- `kitchen_room_export.blend` — merged by material; the FBX came from this one.
- `kitchen_room_web.blend` — adds lightmap UVs and lightmap bake helpers; the GLB
  came from this one. Any re-bake should start here.
- `textures/` and `textures_baked/` — baked material textures (already embedded in
  the GLB).
- `export/` — the web assets. Lightmaps are in `export/lightmaps_web/` (WebP for
  the app, PNG originals) and `export/lightmaps_raw/` (HDR EXR sources).

Do not commit `kitchen_room_full.glb` (66 MB uncompressed backup), the lightmap
PNGs, `lightmaps_raw/*.exr` (~500 MB), or `kitchen_room.fbx` (Cinema 4D test
export).
