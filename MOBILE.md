# Mobile version of the kitchen

The desktop assets use about 1.4 GB of GPU memory once decoded (4K textures and lightmaps), which crashes or blanks out phone browsers. A mobile asset set now exists alongside the desktop one. This doc covers wiring it in, then shrinking GPU memory further with KTX2.

## New asset files

Copy these into `public/kitchen/` next to the desktop files, keeping the `lightmaps_mobile/` subfolder:

| File | Size | Notes |
|---|---|---|
| `kitchen_room_mobile.glb` | 3.5 MB | Same 82 meshes, cameras, and `lightmap_atlas` extras. Color textures capped at 2K; normal and roughness capped at 1K. Draco + WebP, same as desktop |
| `kitchen_lightmaps_mobile.json` | tiny | Same structure as `kitchen_lightmaps.json`, pointing at the mobile GLB, lightmaps, and probe |
| `lightmaps_mobile/LM_Arch.webp` | 0.25 MB | 2K (desktop is 4K) |
| `lightmaps_mobile/LM_Cabinetry.webp` | 0.37 MB | 2K (desktop is 4K) |
| `lightmaps_mobile/LM_Props.webp` | 0.71 MB | 2K (same as desktop) |
| `lightmaps_mobile/LM_Interactive.webp` | 0.41 MB | 2K (same as desktop) |
| `kitchen_probe_mobile.hdr` | 1.5 MB | 1024×512 (desktop is 2048×1024) |

Lightmap encoding is unchanged: sRGB, value = light / 8, UV channel 1, `lightMapIntensity = 8 * Math.PI`. The 4K-to-2K lightmaps were averaged in linear space, so brightness matches the desktop set.

The latest scene changes (Chair_Right moved out of the table, the sink vertex fix) are in both `kitchen_room_02.glb` and `kitchen_room_mobile.glb`.

## Estimated GPU memory

Uncompressed RGBA8 with mipmaps:

| Set | Textures | Lightmaps | Total |
|---|---|---|---|
| Desktop | ~1,170 MB | ~210 MB | ~1.4 GB |
| Mobile (current WebP) | ~300 MB | ~85 MB | ~380 MB |
| Mobile + KTX2 (target) | | | roughly 60–100 MB |

WebP only shrinks the download; the GPU still gets full RGBA. KTX2 (Basis Universal) stays compressed on the GPU, which is the step that makes phones comfortable.

## Task 1: load the mobile set on phones

1. Add a `manifest` option to `loadKitchen` (currently hard-coded to `kitchen_lightmaps.json`). Everything else, including the GLB, probe, and lightmap paths, already comes from the manifest.
2. Choose the set at startup. A reasonable check is `matchMedia('(pointer: coarse)').matches` or a mobile user agent. Note that iPadOS reports as a Mac, so also check `navigator.maxTouchPoints > 1`. Add a URL override (`?quality=mobile` / `?quality=desktop`) so the mobile set can be tested on desktop.
3. Mobile renderer settings: `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))`, lightmap and texture anisotropy capped at about 4, and no heavy post-processing (skip bloom on mobile if it gets added).
4. Camera sway: `pointermove` only fires while a finger is down on touch screens. Either leave sway desktop-only or use device orientation (on iOS this needs a permission prompt triggered by a user tap).
5. Check the character GLB too. His textures count toward the same memory budget; cap them at 1–2K and include them in the KTX2 pass.

Test on a real phone early: run Vite with `--host` and open the LAN URL on the device.

## Task 2: KTX2 textures

1. Convert the mobile GLB's textures with gltf-transform. Typical split: ETC1S for base color and emissive (smallest), UASTC for normal and roughness maps (ETC1S artifacts show badly on normals). gltf-transform's KTX commands depend on KTX-Software being installed; verify the current CLI commands and flags against the gltf-transform docs, since they change between versions. Keep Draco on the output (or switch to meshopt, and register the matching decoder).
2. Convert the four mobile lightmaps to KTX2 separately; they are not inside the GLB. Use UASTC with sRGB transfer, since lightmaps are smooth gradients that ETC1S would band. Update `kitchen_lightmaps_mobile.json` to the `.ktx2` filenames.
3. In the loader, create a `KTX2Loader` with `setTranscoderPath('/basis/')` and `detectSupport(renderer)`, pass it to `GLTFLoader.setKTX2Loader()`, and use it (instead of `TextureLoader`) for `.ktx2` lightmaps. Copy `node_modules/three/examples/jsm/libs/basis/` into `public/basis/`. KTX2 textures ignore `flipY`, which is fine: the lightmaps already use glTF's UV convention. Keep `colorSpace = SRGBColorSpace` and `channel = 1` on them.
4. Compare the KTX2 mobile build against the WebP mobile build side by side before switching over, especially the lightmaps and tile grout.

## Re-exporting later (Colin's machine)

In `kitchen_room_web.blend`, the Text Editor has two scripts, each run with Alt+P:

- `export_web_glb.py` writes the desktop `export/kitchen_room_02.glb`.
- `export_mobile_glb.py` writes `export/kitchen_room_mobile.glb` (downscales in memory only; the 4K source textures are untouched).

Mobile lightmaps are generated from the verified PNGs in `export/lightmaps_png/` by the `mobile_lightmaps.py` text block. The EXR files in `export/lightmaps_raw/` do not round-trip reliably and should not be used as a source.
