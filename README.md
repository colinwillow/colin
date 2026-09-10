# Kitchen Environment — three.js project

A cozy rustic kitchen built in Blender and exported for the web. It is the home environment for Colin's rigged toon "mini-me" character. This repo is a standalone web app, separate from Orb, though pieces may be borrowed from Orb (the character GLB, and later the voice/viseme setup).

## Goal for the first milestone

1. Load the baked kitchen in a web page with three.js.
2. View it from the wide reference camera, which is mostly fixed but allows a few degrees of mouse-driven sway.
3. Drop the rigged character GLB into the room so he looks lit by the same room.

Nothing interactive yet. Interactions (sitting in a chair, opening the fridge, lifting the pot lid, flipping a light switch) come later, and the assets are already set up for them.

## Suggested stack

Vite + TypeScript + three.js. The provided loader (`kitchenEnvironment.js`) is plain three.js; convert it to TypeScript. React Three Fiber also works: load with the same function and mount the result with `<primitive object={room} />`. Ask Colin which he prefers if it matters.

## Assets

Copy these into `public/kitchen/`, keeping the `lightmaps/` subfolder:

| File | Size | What it is |
|---|---|---|
| `kitchen_room.glb` | ~4.9 MB | The room: 82 meshes, two cameras. Draco-compressed geometry, WebP textures (`EXT_texture_webp`) |
| `lightmaps/LM_Arch.webp` | ~1.6 MB | Baked light and shadow for walls, floor, ceiling, beams, tile, rugs |
| `lightmaps/LM_Cabinetry.webp` | ~1.2 MB | Baked light for cabinets, counters, shelves, stove, table |
| `lightmaps/LM_Props.webp` | ~0.7 MB | Baked light for pottery, plants, books, jars, and other props |
| `lightmaps/LM_Interactive.webp` | ~0.4 MB | Baked light for the movable objects (at their rest positions) |
| `kitchen_probe.hdr` | ~5.4 MB | 360° HDR panorama rendered from the middle of the room |
| `kitchen_lightmaps.json` | tiny | Manifest: atlas files, mesh-to-atlas map, encoding, exposure, interactive names |
| `kitchenEnvironment.js` | — | Loader. Goes in `src/`, not `public/` |

About 14 MB total. On Colin's machine the lightmaps live in `export/lightmaps_web/`; copy only the `.webp` files into `public/kitchen/lightmaps/`.

Do not copy `kitchen_room_full.glb` (66 MB uncompressed backup), the lightmap PNGs, `lightmaps_raw/*.exr` (source HDR lightmaps, ~500 MB total), or `kitchen_room.fbx` (Cinema 4D test export).

**Git:** every file is now well under GitHub's limits, so Git LFS is optional. It's still worth considering if the assets will be re-exported often, since binary history grows the repo.

**Draco decoder:** the GLB's geometry is Draco-compressed, so three.js needs the decoder files. Copy `node_modules/three/examples/jsm/libs/draco/gltf/` into `public/draco/`. The loader looks there by default (the `dracoPath` option).

## How the lighting works

Read this before changing any materials or adding lights.

- **The room's lighting is baked into lightmaps.** Each lightmapped mesh has a second UV set (`TEXCOORD_1`). The loader assigns the right lightmap to every material using the `lightmap_atlas` value in the mesh's glTF extras (`userData.lightmap_atlas`), with the manifest as a fallback.
- **Lightmap encoding.** The WebP lightmaps store `light / 8`, sRGB-encoded, so they fit 8-bit without clipping the window sunlight. Decode with `texture.colorSpace = SRGBColorSpace`, `texture.channel = 1`, `texture.flipY = false`, and `material.lightMapIntensity = 8 * Math.PI`. The π compensates for three.js dividing lightmap irradiance by π in the Lambert term.
- **Materials are cloned per mesh** before a lightmap is assigned, because one glTF material (for example the chair wood) can be shared by meshes that use different lightmap atlases.
- **Metals, glass, and glowing objects have no lightmap.** That covers chrome, copper, brass, all glass, the LED strip, the pendant bulb, and the outdoor backdrop. They are lit by the environment map only.
- **The HDR probe is `scene.environment`**, run through PMREM. It lights the character and provides reflections. Lightmapped materials use `envMapIntensity = 0.25` so they get reflections without being lit twice.
- **There are intentionally no real-time lights.** In three.js a light would also hit the already-lit walls and roughly double their brightness. The character is lit entirely by the environment map. For grounding, add a soft contact shadow or blob shadow under him rather than a shadow-casting light.
- **Tone mapping** is `AgXToneMapping` with exposure around 0.55, to match Blender's AgX view and -0.85 exposure. Output color space is sRGB.
- **Glass** gets `depthWrite = false`.

## Coordinates

Units are meters. Blender is Z-up and glTF/three.js is Y-up, so a Blender point `(x, y, z)` becomes three.js `(x, z, -y)`.

In three.js terms:

- Floor is at `y = 0`; ceiling at `y = 3.45`.
- Back wall (stove, fridge, glass cabinet) is at `z = 0`; the room extends toward `+z`, about 6 m.
- Left wall (window and sink) is at `x = -3.1`; right wall (doorway, sideboard) is at `x = 1.53`.
- A good starting spot for the character is `(-0.3, 0, 1.7)`, standing on the rug in front of the stove. The HDR probe was rendered from `(-0.3, 1.1, 1.7)`, so lighting on the character is most accurate near there.

## Cameras

The GLB contains two cameras. The loader returns the camera whose parent node is `Camera_Wide`.

- **`Camera_Wide`** is the main view: a 24 mm lens, framed on a 3:2 reference image. Set `camera.aspect` to the canvas aspect on load and on resize, and call `updateProjectionMatrix()`.
- **`Camera_Closeup`** is a tighter view of the stove-and-fridge wall, framed square.

`addCameraSway(camera)` in the loader returns an `update()` function to call every frame. It adds a small mouse-follow rotation, 2.5° by default.

## Interactive objects

These are separate meshes, and each pivot is placed where the object naturally moves. The loader returns them as `interactive[name]`.

| Name | Pivot | Future use |
|---|---|---|
| `Chair_Far`, `Chair_Right`, `Chair_NearLeft` | Center of the base, on the floor | Sit anchor: add an empty or bone target at seat height |
| `Fridge_Door` | Hinge edge, right side of the fridge, bottom of the upper door | Rotate about Y to open. Test which sign swings it toward the camera |
| `Fridge_Body` | Base center | Static counterpart to the door |
| `Stove_OvenDoor` | Bottom front edge of the oven | Rotate about X to drop open |
| `DutchOven_Pot`, `DutchOven_Lid` | Bottom center | Pick up / lift lid |
| `Pendant_Lamp` | Ceiling mount | Can swing; the bulb is emissive |
| `Mug_Table`, `FruitBowl`, `CopperSkillet`, `CopperSaucepan` | Near the bottom center | Pick up |

These objects' lightmaps were baked at their rest positions. When one moves far, such as a pot carried across the room, set its `lightMap` to null and raise its `envMapIntensity` to about 1 so it is lit by the probe like the character.

## First session tasks

1. Scaffold Vite + TypeScript + three.js. Set up Git LFS before adding assets.
2. Copy the assets into `public/kitchen/`, copy the Draco decoder into `public/draco/`, and move the loader into `src/`, converting it to TypeScript.
3. Create the renderer and scene, call `loadKitchen(renderer, scene, { basePath: '/kitchen/' })`, use the returned camera, and handle resize.
4. Add the camera sway and a render loop.
5. Load the character GLB, which Colin will provide from the Orb project. Place him at `(-0.3, 0, 1.7)` facing `+z` toward the camera, play an idle animation if one exists, and add a contact shadow.
6. Show Colin the result and tune the knobs below by eye.

## Tuning knobs

- **Overall brightness:** `exposure` in `kitchen_lightmaps.json` (0.55). The bake came out a bit brighter than Colin's Blender Eevee render, so expect to lower it slightly.
- **Room light strength relative to the character:** `lightMapIntensity` (8π) on lightmapped materials.
- **Reflections on room surfaces:** `envMapIntensity` (0.25) on lightmapped materials.
- **Character brightness:** his materials' `envMapIntensity`, or `scene.environmentIntensity`.

## Things to verify early

- **Loader name.** `HDRLoader` exists in recent three.js. On older versions, use `RGBELoader` from `three/addons/loaders/RGBELoader.js`.
- **Lightmap scale.** If the room is roughly 3× too bright or too dark, the π factor is the likely cause. Try `lightMapIntensity = 8` instead of `8 * Math.PI`.
- **Probe orientation.** Reflections should be warm and bright on the window side (`-x`). If they look mirrored or rotated, adjust `scene.environmentRotation`.
- **Lightmap UV flip.** If lightmaps look scrambled, confirm `flipY = false` on the lightmap textures.

## Later milestones

1. **Mobile GPU memory.** Download size is already handled (Draco + WebP, ~14 MB total). WebP only shrinks the download, though: a 4K texture still takes about 64 MB of GPU memory once decoded, and there are several. For phones, convert textures to KTX2 (Basis Universal) with gltf-transform, which stays compressed on the GPU, and consider 2K versions of the 4K textures and lightmaps. Keep lightmaps in sRGB and update the manifest if their format changes.
2. **Interactions.** Add sit anchors on the chairs, door hinge animations for the fridge and oven, pick-up targets for the pot, lid, mug, and pans, and pathing for the character.
3. **Light switch.** Colin can bake a second lightmap set with the lights off. Crossfade between the two sets in a shader, or by swapping textures while fading intensity, and dim the pendant bulb's emissive at the same time.
4. **Voice and visemes.** Possibly bring over the talking-character setup from Orb.

## Source files (Colin's machine)

`C:\Users\colin\Desktop\3D STUFF\5_ENVIRONMENTS\kitchen_room\`

- `kitchen_room.blend` — procedural master; edit design changes here.
- `kitchen_room_bake.blend` — baked textures, objects still separate.
- `kitchen_room_export.blend` — merged by material; the FBX came from this one.
- `kitchen_room_web.blend` — adds lightmap UVs and lightmap bake helpers; the GLB came from this one. Any re-bake should start here.
- `textures/` and `textures_baked/` — baked material textures (already embedded in the GLB).
- `export/` — the web assets. Lightmaps are in `export/lightmaps_web/` (WebP for the app, PNG originals) and `export/lightmaps_raw/` (HDR EXR sources).
