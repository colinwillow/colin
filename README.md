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

**Milestone 1 — the room renders, and Colin is standing in it.** The baked
kitchen loads from the wide reference camera with mouse sway, matching the
Blender framing, and the rigged character stands on the rug in front of the
stove playing an idle, lit by the same probe. Nothing is interactive yet.

Still to do: interactions, then the face and voice.

## Layout

```
index.html                      loading overlay + canvas
src/main.ts                     renderer, resize, render loop, tuning panel
src/kitchenEnvironment.ts       loads the GLB, wires up lightmaps and the HDR probe
src/character.ts                loads Colin, fits him to height, contact shadow
public/kitchen/                 the baked assets, served verbatim
  kitchen_room_02.glb           the room: 82 meshes, Draco + WebP
  kitchen_lightmaps.json        manifest: atlases, mesh->atlas map, exposure, interactive names
  kitchen_probe.hdr             360° HDR panorama shot from the middle of the room
  lightmaps/LM_Arch.webp        walls, floor, ceiling, beams, tile, rugs
  lightmaps/LM_Cabinetry.webp   cabinets, counters, shelves, stove, table
  lightmaps/LM_Props.webp       pottery, plants, books, jars
  lightmaps/LM_Interactive.webp the movable objects, baked at rest position
public/character/
  colin_slim.glb                the rigged character, from colinwillow/glorp
  colin_diffuse_2k.webp         his skin, overriding the one inside the GLB
scripts/screenshot.mjs          optional headless render check (see below)
```

About 14 MB of assets. Every file is well under GitHub's limits, so Git LFS is
optional — worth revisiting if the bake gets re-exported often, since binary
history grows the repo.

### Re-exporting the room from Blender

The manifest's `glb` field names the export in use, so a new one is dropped into
`public/kitchen/` and pointed at. Two exporter checkboxes are easy to miss:

- **Include > Cameras**, or the GLB has no `Camera_Wide` and the loader falls
  back to `cameraFallback` in the manifest — the same transform, but a copy that
  can drift from the .blend. It warns in the console when this happens.
- **Include > Custom Properties**, which carry each node's `lightmap_atlas` tag.
  Without them the loader falls back to the manifest's `meshes` map. That map
  covers all 72 lightmapped meshes today, but a mesh added later and missing from
  it would silently render unlit.

Both are on in the current export. A quick check after any re-export: the console
line on load should name `Camera_Wide` with no fallback warning, report 90
lightmapped materials, and `window.kitchen.interactive` should have no undefined
entries.

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

## The character

`colin_stylized_01.glb` is Colin's export: one mesh, texture embedded as WebP,
Draco-compressed, 66 joints and 49 animation clips (`idle_neutral_00..03`,
`idle_happy_bob`, `idle_waving`, walks, runs, dances, falls, stand-ups). It
supersedes `colin_slim.glb`, the original import from the Orb/glorp project,
which had 36 clips and a much darker skin.

Still to come from glorp when the voice does: `colin_head.glb`, 92 morph targets,
grafted at the head joint for a face with blendshapes.

- **Fitted, not scaled by a constant.** The rig arrives in centimetres under a
  root scaled by 0.01, and it is skinned, so its own numbers say little about
  final height — he measures 5.467 units in bind pose.
  `loadCharacter` measures the bind pose and fits it to `height` (1.75 m), then
  drops his feet to `y = 0` and centres him over `root.position`. A different
  body file can be dropped in without retuning anything.
- **Lit by the probe plus a rig of his own.** See below — the room still has no
  real-time lights.
- **Contact shadow, not a cast shadow.** A soft ellipse on the floor, multiply
  blended so it darkens the floor's baked light rather than laying grey over it.
  Multiply ignores alpha, so the texture is opaque and fades to *white*; fading to
  transparent would multiply the floor by zero and stamp a black square around
  him. It sits at `y = 0.02` to clear the rug, which was hiding it.
- **`frustumCulled = false`** on his meshes: skinned bounds are computed for the
  bind pose, so a raised arm can leave the box and pop out mid-animation.

The Colin folder in the tuning panel switches clip, turns him, and adjusts his
brightness and shadow. From the console he is `window.colin` —
`colin.play('idle_waving')`, `colin.clips`, `colin.root.position`.

### Why he looks dark, and how he is lit

He renders far darker than the same model does in a standalone viewer, for two
reasons that took some digging.

**`material.envMapIntensity` was doing nothing.** three overwrites it:

```js
// WebGLRenderer, when binding a program
if ( material.isMeshStandardMaterial && material.envMap === null && scene.environment !== null ) {
    m_uniforms.envMapIntensity.value = scene.environmentIntensity;
}
```

Any material that leaves its own `envMap` null and sits in a scene with an
`environment` gets the *scene's* intensity, and whatever the material asked for is
discarded. That silently applied to the room too — its documented
`envMapIntensity = 0.25`, the one meant to stop baked surfaces being double-lit,
had been running at 1 the whole time. Both the room and Colin now assign
`envMap` explicitly, which is what makes the per-material value take effect.

**The probe reads below the baked room.** The lightmaps recover their true level
by multiplying by `encodeScale` (8); the probe gets no equivalent compensation, so
lighting him at a physical 1.0 leaves him under the room he is standing in. He
runs at 2.5, which puts his hoodie at about 61 against 60 in Colin's own render of
the same model.

The room is warm, so he correctly picks up a colour cast a neutral studio render
will not have; the fill light is cool and comparatively strong to keep that from
tipping orange.

**He cannot be matched exactly to a standalone render, and that is AgX.** The
curve that makes the room match Blender compresses and desaturates as values
rise, so his charcoal hoodie drifts grey and his skin caps around 122 where a
plain sRGB view of the same model reaches 200. Because he is a separate pass he
can carry his own curve — the panel's **tone curve** picks it, with `None` being
the raw look a standalone viewer gives. It defaults to AgX, matching the room,
since a character on a different curve to the set he stands in tends to read as
composited in.

*Measuring this yourself:* freeze the idle first (`colin.mixer.timeScale = 0`).
Sampling a patch of him while he breathes measures the animation, not the light —
it produced a bogus reading that looked like a lighting non-linearity.

So he gets three directional lights following the room — key from the window wall
at `-x`, a cool bounce from the doorway at `+x`, and a rim from behind to lift him
off the stove.

**Those lights cannot live in the kitchen scene.** The room's light is baked, so a
light there would fall on walls that are already lit and roughly double their
brightness. three has no way to aim a light at one object either — it filters
lights by the *camera's* layers, not per object, so a light on its own layer is
excluded outright rather than applied selectively. The isolation comes from the
render loop instead:

```js
renderer.autoClear = false;
renderer.clear();
renderer.render(scene, camera);            // the baked room, no lights
renderer.render(characterScene, camera);   // Colin, lit by his own rig
```

Two scenes, one camera, one depth buffer. His lights physically cannot reach the
room, he is still correctly occluded by the furniture, and his contact shadow
still multiplies against the floor drawn in the first pass. `characterScene.environment`
is the same probe, so the room's own light still reaches him.

**To restyle him, replace `public/character/colin_diffuse_2k.webp`.** It is
loaded over whatever base colour map the GLB carries, so a repainted atlas takes
effect with no code change and no re-export. It must live under `public/` — files
elsewhere in the repo are not served. The same hook is how the other bodies will
be dressed: `colin_anim2` and `colin_animations_02` ship with no map at all.

The **Colin — lighting** folder in the panel has the handles. `HDR probe` is his
`envMapIntensity`; `key`/`fill`/`rim` are the three lights. The last two matter
most given the albedo: `roughness` decides how much specular edge he catches (the
model ships at 0.9, very matte), and `albedo lift` multiplies his base colour
above 1, which is the only thing that actually makes the black cloth lighter
rather than shinier.

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

The GLB carries two cameras, both as **root nodes** of the scene. three names the
resulting object after the glTF *camera* (`Cam_Wide`, `Cam_Main`) while keeping
the node name in `userData.name`, so the loader matches on the object name, its
`userData.name`, or its parent's — matching only on the parent silently falls
through to `gltf.cameras[0]`, which is the closeup.

If an export ever ships without cameras, `cameraFallback` in the manifest stands
in: position `(-0.36, 1.25, 4.9)`, no rotation, 53.13° vertical FOV, 3:2. It is a
safety net that warns loudly, not the intended path.

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

`kitchen_room_02.glb` fixes it in the model, and that is the right place for it:
a load-time pass that pushed coplanar patches apart was tried and dropped, having
resolved 42 of the 173 cases where the model fix resolved all of them. Keep trim a
hair proud of the surface behind it rather than flush.

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

1. **Mobile GPU memory.** Download size is already handled (Draco + WebP, ~14 MB).
   WebP only shrinks the download, though: a 4K texture still takes about 64 MB of
   GPU memory once decoded, and there are several. For phones, convert textures to
   KTX2 (Basis Universal) with gltf-transform, which stays compressed on the GPU,
   and consider 2K versions of the 4K textures and lightmaps. Keep lightmaps in
   sRGB and update the manifest if their format changes.
2. **Interactions.** Sit anchors on the chairs, door hinge animations for the
   fridge and oven, pick-up targets for the pot, lid, mug, and pans, and pathing
   for the character.
3. **Light switch.** Colin can bake a second lightmap set with the lights off.
   Crossfade between the two sets in a shader, or by swapping textures while
   fading intensity, and dim the pendant bulb's emissive at the same time.
4. **The face, voice and visemes.** Bring over the talking-character setup from
   glorp: `colin_head.glb` (92 morph targets) grafted at the head joint, the
   Cloudflare Worker in `worker/` (Claude brain + ElevenLabs voice clone,
   `persona-colin.md`), and the viseme rig. API tokens will need reconnecting.

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
