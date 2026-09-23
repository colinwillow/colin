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
stove playing an idle, lit by the same probe.

**Milestone 2 — he hears you and answers.** Push to talk, a greeting, a streamed
reply from the Worker, his own voice, and a mouth timed to it. See *Talking to
him*.

**Milestone 3 — there is an app around him.** Outfits, poses, moods, emotes,
backdrops, a camera and a gallery, with him live on screen behind all of it. See
*The app around him*.

**Milestone 4 — the app gets out of the way.** It opens on him, with a front door
that collects the one tap everything needs and a greeting on the other side of
it. The meter reads your actual voice. And there is a switch that redraws him as
a cel-shaded drawing, for comparing. See *Him, and nothing else* and *The other
way he could look*.

**Milestone 5 — an empty white room.** That is what it opens on now: no set, a
real cast shadow on the floor, and nothing on top of him but three lines that
move with whoever is talking. The kitchen is one tap away in Rooms.

Still to do: more wearables and more rooms, both of which are Blender exports
rather than code — and voice commands, which is where this is actually going.

## Layout

```
index.html                      loading overlay + canvas
src/main.ts                     renderer, resize, render loop, tuning panel
src/kitchenEnvironment.ts       loads the GLB, wires up lightmaps and the HDR probe
src/character.ts                loads Colin, fits him to height, contact shadow
src/wander.ts                   walks him around the room on his own
src/face.ts                     his face: the shape rig, blinks, gaze, expressions
src/mood.ts                     how he is feeling: two numbers with inertia
src/commands.ts                 being told to do something, and him doing it
src/wave.ts                     the level meter along the bottom
src/talk.ts                     the conversation: ears -> brain -> voice -> mouth
src/listen.ts                   the browser's speech recognition, and when to deafen it
src/mic.ts                      your voice as audio, for the meter — not the recogniser
src/audio.ts                    what a sound is doing: level, bands, brightness, onsets
src/ground.ts                   the studio floor, and the shadow that makes it one
src/look.ts                     brightness, roughness, emission, saturation — his taste
src/toon.ts                     the other way he could look: bands, a rim, an ink line
src/brain.ts                    the Worker chat call, streamed
src/voice.ts                    the ElevenLabs clone: chunking, scheduling, the audio graph
src/visemes.ts                  text and character timings -> mouth shapes -> morph targets
src/roomLights.ts               the experiment: real lights with the bake switched off
src/stage.ts                    which room he is in: the baked kitchen, or a studio sweep
src/shot.ts                     framing him on a mark instead of following him around
src/poses.ts                    a pose is a frozen frame of a clip; saving and restoring them
src/wardrobe.ts                 what he is wearing, discovered from the export's mesh names
src/photos.ts                   the shutter, and the pictures it keeps in IndexedDB
src/ui/                         the app around the render — see "The app around him"
  index.ts                      mounts it; the one import main.ts makes
  shell.ts                      screens, regions, routing, the tab bar
  context.ts                    everything a screen is allowed to touch
  dom.ts                        el(), icon(), button() — the whole view layer
  ui.css                        the look: one scale, one radius, one shadow
  screens/                      stage, home, outfits, poses, mood, emotes, rooms, look, camera, gallery, more
VISEMES.md                      what the face has, and who is allowed to move it
public/kitchen/                 the baked assets, served verbatim
  kitchen_room_02.glb           the room: 82 meshes, Draco + WebP
  kitchen_lightmaps.json        manifest: atlases, mesh->atlas map, exposure, interactive names
  kitchen_probe.hdr             360° HDR panorama shot from the middle of the room
  lightmaps/LM_Arch.webp        walls, floor, ceiling, beams, tile, rugs
  lightmaps/LM_Cabinetry.webp   cabinets, counters, shelves, stove, table
  lightmaps/LM_Props.webp       pottery, plants, books, jars
  lightmaps/LM_Interactive.webp the movable objects, baked at rest position
public/character/
  colin.glb                     the whole character: body, face, eyes, teeth, clips
scripts/screenshot.mjs          optional headless render check (see below)
scripts/talk-check.mjs          exercises the talking pipeline with the Worker stubbed
scripts/mic-check.mjs           the push-to-talk path: greeting first, one recogniser start
scripts/latency-check.mjs       does he start talking before the reply has finished
scripts/ui-tour.mjs             a PNG of every screen at phone size, and no errors on the way
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

`colin.glb` is all of him: body, outfit, headphones, head, eyes and teeth on one
skeleton, Draco-compressed with its textures embedded as WebP — 66 joints, 19
animation clips, and the face's morph targets along for the ride.

One file for every quality tier. Its textures are authored small (two at 1080,
three at 512, about 320 KB packed and ~12 MB on the GPU), so there is nothing a
KTX2 variant would save and no second asset tier to forget to rebuild.

It replaced a body GLB with a separately grafted head — two files, a shader that
threw the body's own head away, and a second set of face textures. All of that
machinery is gone; see **VISEMES.md** for what the face has now and `src/face.ts`
for who is allowed to move it.

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

**Once emission carries him, the lighting has to come back down.** The probe boost
and the three lights were there to compensate for a near-black skin. Stacking 50%
emission on top of that compensation blew him out — his hoodie went to 107 against
about 75 in the reference. The probe is back to a physical 1.0 and the rig runs at
roughly a third of what it was, so the lights shape him rather than set his level.

The room is warm, so he correctly picks up a colour cast a neutral studio render
will not have; the fill light is cool to keep that from tipping orange.

**Emission is what gets him past AgX.** The curve that makes the room match
Blender compresses and desaturates as values rise, so lighting him harder only washed
him out — his charcoal hoodie drifted grey and his skin capped near 122 where the
target is 200. Colin's own Blender setup for this room solves it by feeding the
diffuse texture back in as an emission map at 50%, with roughness 0.8, and the
same three settings do the same job here:

| | |
|---|---|
| `baseColorMap` | unused — `colin.glb` carries its own skin; the hook remains for an export that ships a dark one |
| `emissiveIntensity` | 0.65, with the base colour map as the emission map |
| `roughness` | 0.8 |

Emission is not physical, but it lands on top of the shading rather than being
fed through it, so it survives the curve: the hoodie keeps its charcoal and the
denim its blue instead of drifting grey. The panel's **self-illumination** slider is this value.

**He runs on a different tone curve to the room, on purpose.** Because he is a
separate pass he can, and matching Colin's Blender render of this same scene says
he should. Measured against it, at the emission level that puts his hoodie right:

| curve | hoodie | skin | skin / hoodie |
|---|---|---|---|
| AgX (the room's) | 75 | 143 | 1.91 |
| Neutral | 44 | 134 | 3.05 |
| **ACESFilmic** | 55 | 149 | **2.71** |
| None | 90 | 188 | 2.09 |
| *Colin's reference* | *75* | *205* | *2.73* |

AgX holds his hoodie at the right level but crushes everything above it — his skin
lands at 1.9x the hoodie where the reference is 2.7x. ACES reproduces that ratio
almost exactly and only needs a little more exposure to sit at the same level,
hence `ACESFilmicToneMapping` at 0.75 against the room's AgX at 0.55. The panel's
**tone curve** and **his exposure** are these two values; `None` is the raw look a
standalone viewer gives.

Raising exposure flattens the ratio again (2.71 at 0.55, 2.41 at 0.75, 2.08 at
1.05), so level and contrast trade against each other — 0.75 is the compromise
that keeps the hoodie on target.

**He is 2K where the room is 4K, which is why he looks softer.** Measured detail
per texture (mean absolute Laplacian over the populated area, higher = more
high-frequency content):

| texture | size | detail | relative |
|---|---|---|---|
| his atlas | 2048² | 9.46 | 0.114 |
| `Wood_Cabinet` | **4096²** | 3.23 | 0.046 |
| `Tile_Blue` | **4096²** | 4.65 | 0.032 |
| `Rug_Woven` | 2048² | 32.27 | 0.208 |

His art is not the soft one — it carries more relative detail than the cabinets or
tile. The room simply has twice his linear resolution on its large surfaces, and
each of its 4K maps covers a single material where his one 2K map covers skin,
hair, hoodie, jeans, shoes and eyes at once, with only about 38% of the atlas
populated. Exporting his atlas at 4K, or repacking his UVs to fill more of the 2K,
is what would close the gap. Compression is not the cause: a re-exported repaint
measured *sharper* than the skin embedded in the GLB (9.46 against 5.41), so the
WebP-in, WebP-out round trip cost nothing visible.

(Measured on the body GLB that preceded `colin.glb`, whose one 2K atlas this
describes. The current export splits the load across five smaller maps.)

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

**To restyle him without a re-export,** point `baseColorMap` at a repainted atlas
under `public/`: it is loaded over whatever base colour map the GLB carries, so it
takes effect with no code change. Unused today — `colin.glb` carries its own — and
kept for an export that ships a dark skin, which is what the hook was built for.
Files must live under `public/`; anything elsewhere in the repo is not served.

The **Colin — lighting** folder in the panel has the handles. `HDR probe` is his
`envMapIntensity`; `key`/`fill`/`rim` are the three lights. The last two matter
most given the albedo: `roughness` decides how much specular edge he catches (the
model ships at 0.9, very matte), and `albedo lift` multiplies his base colour
above 1, which is the only thing that actually makes the black cloth lighter
rather than shinier.

## Asset sets

Three, chosen by `src/quality.ts` at startup and overridable with
`?quality=desktop` / `mobile` / `mobile-ktx2`. See MOBILE.md.

| set | download | est. GPU (room + Colin) | who gets it |
|---|---|---|---|
| `desktop` | 18.0 MB | ~1387 + 21 MB | fine pointer |
| `mobile` | 14.4 MB | ~382 + 21 MB | comparison only |
| **`mobile-ktx2`** | **26.4 MB** | **~117 MB total** | phones and iPads |

> **After any re-bake, rebuild the KTX2 set — `bash scripts/make-mobile-ktx2.sh`
> — and re-sync its manifest.** `mobile-ktx2` is a *derived* tier: its GLB is
> transcoded from `kitchen_room_mobile.glb`, its lightmaps from
> `lightmaps_mobile/`, and `kitchen_lightmaps_mobile_ktx2.json` is its own file.
> Drop new assets in without that step and desktop shows the new room while
> **every phone silently keeps the old one** — which is exactly what happened
> the first time: the chairs were gone on desktop and still standing on a phone.
> The manifest is the mobile one with three fields put back: `atlases` pointing
> at `lightmaps_mobile_ktx2/*.ktx2`, `glb`, and `cameraFallback`.

Colin is not in the KTX2 pass — `colin.glb`'s textures are already small. The lighter
skin baked in rather than overridden at runtime, which also spares a phone
decoding the original 2K atlas just to throw it away. His skin as ETC1S costs
5 MB against 21 MB as RGBA8. `scripts/bake-character-skin.mjs` does the baking
step; the rest is the same ETC1S command as the room.

GPU memory is what blanks a phone browser, and WebP does nothing for it — a WebP
texture is still full RGBA once decoded. KTX2 stays compressed on the GPU, which
is why phones get that set even though it nearly doubles the download. ETC1S for
colour, UASTC for normal, roughness and the lightmaps.

`scripts/make-mobile-ktx2.sh` rebuilds it from the WebP mobile set. Three things
about that toolchain are worth knowing before touching it, because each fails
*silently*:

- **KTX-Software cannot read WebP.** Every texture is skipped with a warning and
  the output is uncompressed. Hence the PNG decode step first.
- **`gltf-transform png` needs `sharp`**, an optional dependency of the CLI. If it
  is missing the command reports success and converts nothing.
- **KTX-Software must be 4.4 or newer.** gltf-transform 4.5 calls
  `ktx create --assign-tf`, which 4.3 does not have; it fails per texture and
  leaves everything uncompressed.

The transcoder needs no copy into `public/`. Like `DRACOLoader`, `KTX2Loader`
resolves its own basis transcoder through `import.meta.url`, so the bundler emits
it — MOBILE.md's instruction to copy `three/examples/jsm/libs/basis/` is not
needed on this setup.

Lightmaps are UASTC rather than ETC1S because they are smooth gradients that
ETC1S bands. RDO at lambda 2.0 roughly halves their size for about 10 dB of PSNR
(54.8 → 45.0), well clear of where banding shows: the four atlases come to 8.6 MB
instead of 10.9 MB. Measured on the final render, the KTX2 set sits at 37 dB PSNR
against the WebP one, with no banding visible on the walls, ceiling or tile grout.

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

`kitchen.resize(width, height)` points the camera at the viewport, and
`kitchen.framing` decides how:

- **`lens`** (default) keeps the focal length whatever the window is, cropping
  the sides on a tall screen.
- **`cover`** instead holds the Blender shot's horizontal framing by opening the
  lens up, so nothing is lost from the sides.

At 3:2 or wider the two are identical, so this only decides what a tall viewport
does — and there `cover` is punishing. Holding the full room width at a phone's
0.46 aspect means a **117° vertical FOV, a 7 mm fisheye**, which is what throws
the near table and chairs across half the screen. `maxFov` caps that, and only
bites in `cover` mode.

On a phone the reference 24 mm crops most of the kitchen away, so mobile opens up
to **16 mm** — roughly halfway between that and the 7 mm the fit would reach on
its own. Desktop keeps 24 mm.

The panel's **Camera** folder carries these, plus **lens (mm)** as a
35mm-equivalent focal length — the bake is 24 mm, longer crops in from the same
spot, wider brings the room back — and **camera back (m)**, which dollies the
camera straight down its own view axis.

### Lens and dolly are one decision

A longer lens is a narrower field of view: it crops in, and the room goes with
it, so on its own it buys compression at the cost of the set. Backing the camera
off returns the field of view while **keeping** the compression. That is the
whole difference between a portrait lens and a zoom — at 16 mm from three metres
his nose is nearer the lens than his ears by a visible fraction of the distance,
and at 25 mm from six it is not.

To hold him the same size on screen, roughly:

```
dolly ≈ distance × (newLens / oldLens − 1)
```

He stands about 3.2 m from the baked camera, so 16 → 25 mm wants about 1.8 m
back to break even, and anything past that trades his size for more room.

**Phones now ship 25 mm with 2.6 m back** (`lensMm` and `dollyM` in
`src/quality.ts`, paired per tier). The extra 0.8 m past break-even is
deliberate: it buys the whole rug and both counter runs. At 16 mm the near edge
of the room stretched hard into the corners and his head went with it.

**Desktop is deliberately untouched** — no `lensMm`, no `dollyM`, so it keeps the
shot exactly as Blender framed it at 24 mm. The pairing above was judged on a
phone; desktop is landscape and wants its own look, which nobody has looked at
yet.

Nothing behind the camera in the GLB, incidentally — raycast 40 m back and it
hits nothing — so the dolly has no wall to clip through.

The near dining set used to be hidden at runtime, which left the shade of
furniture that was no longer there baked into the floor — a hard rectangular
shadow edge across the boards. That is gone: the room was re-exported without the
chairs, table top, mug and fruit bowl, with the stool and side table moved, and
the lightmaps re-baked to match. The runtime hiding list went with it.

`addCameraSway(camera, dom, config)` returns an `update()` function to call every
frame. It adds a small mouse-follow rotation, 2.5° by default; mutate
`config.maxDeg` to change it live.

`src/cameraRig.ts` composes everything onto that baked orientation rather than
replacing it, so the Blender framing stays the anchor:

- **Follow.** The camera drifts a couple of degrees after Colin as he moves,
  aimed at his chest rather than his feet so it does not dip as he approaches.
  Deliberately laggy — it should trail him, not track him.
- **Mouse sway**, desktop only. `pointermove` on a touch screen fires just while
  a finger is down, which reads as a lurch on tap rather than as breathing.

A device-tilt version came and went. It works, but iOS only grants
`deviceorientation` from inside a user gesture, and spending a permission prompt
on two degrees of parallax — on top of the one the microphone will need — is a
bad trade. Following him costs nothing and asks for nothing.

## Wandering

`src/wander.ts` walks him around the open strip of floor: idle for a few
seconds, pick a spot, turn to face it, walk, arrive, idle again.

The walk clips carry **no net root motion** — `walk_fwd_normal` drifts 0.0 units
across its length — so they are in-place cycles and the position is ours to
drive. Nothing ties the clip's stride to the distance covered, so `speed` is a
number picked by eye; too high and his feet skate.

**The camera keeps him centred, with a beat of lag.** It pans up to 30° and
takes 95% of the angle to him, which covers the worst corner of the walk area
outright — measured, the corners sit between -28.7° and +19.2° from the baked
framing. Standing still he lands within 0.06 of dead centre anywhere on the
floor; walking at his 0.62 m/s he leads the frame by about 0.38 and the camera
catches up when he stops. That lag is the point: an operator following someone,
not a turret welded to them. Pitch gets a much smaller share of the budget
(15%), since the room is wide and short and a camera that tilts as much as it
pans looks seasick.

**He mostly stands, but is not parked.** Every pause used to end in a walk, and
walk-pause-walk-pause is the one rhythm a person never has. A pause now rolls: a
third of the time it ends in nothing but a different idle, a fifth in a turn on
the spot, and the rest in going somewhere. Measured over three simulated minutes:
**84% standing, 8% turning, 8% walking**.

Never the same idle twice running, and **idles that read as a mood are held out
of the neutral pool** — falling into the dejected one at random would make the
mood layer mean nothing. Idles are matched by pattern rather than listed, so a
re-export with a dozen of them needs no code change.

### Mood

`src/mood.ts`. Not commands — "do a backflip" is a different and easier feature.
This is the part where he reacts to what was said rather than to what he was
asked for: something sharp puts him on his guard, food turns his mind to the
fridge. A mood picks an expression and narrows which idle he falls into, and
nothing else yet, which is the point — the hook is in one place for when there is
a fighting stance or a fridge to put behind it.

**It reads keywords, and that is a stand-in.** Where this belongs is the model:
the Worker already streams a control frame after a NUL byte, so a `mood` on that
frame would replace the whole of `moodFor` without anything downstream noticing.
Until the Worker's prompt knows to send one, keywords are honest about being a
guess and cost nothing.

**How wide he can roam is a camera question, not a floor question.** The floor
was never the limit — it runs clear from x -2.25 to +1.0 — but anything outside
the frame may as well not exist, and at the old 2.6° of follow the shot barely
moved, so he was stuck in a rug-width corridor where the Blender framing already
pointed. The rig now pans up to 18° and takes 80% of the angle to him, which
gives him 2.6 m instead of 1.7 m and, as a bonus, shows off a side of the room
the fixed shot never revealed: the window over the sink, the pendant, the left
counter run. (An earlier pass capped the pan at 18°, which was not enough to
centre him at the far left — he sat 11° off axis and only drifted back once he
had walked out of the corner of frame.) The near edge still caps the depth, because that is his feet
leaving the bottom of a landscape frame and no amount of panning fixes it.

**The walk cycle is tied to his ground speed.** The clips are in-place, so
nothing connects the stride to the floor — which means the speed is free to pick,
and picking it wrong is exactly what makes a character skate. `walk_fwd_normal`
strides for **1.77 m/s** and the wander had been driving him at 0.62, nearly
three times too slow. The clip's playback rate is now `speed / 1.77`, so any
speed is slide-free and the number only decides whether he ambles or marches;
shipped at 1.15 m/s, which plays the cycle at 0.65×.

Worth writing down how that 1.77 was arrived at, because the obvious method is
wrong. Sampling the planted foot's backward velocity relative to the root reads
**1.54** — during double support the "lower foot" test picks the swinging one and
drags the average down. Measuring the thing that actually matters instead —
sweep the playback rate, watch how fast the planted foot slides across the
*floor* — bottoms out at 0.65 for a body moving at 1.15 m/s, which puts the real
stride at 1.77. Slip at the shipped setting is 0.16 m/s against 0.65 at the
authored rate.

**The rectangle is measured, not guessed.** The camera sits at z 4.9, so a
*bigger* z is *nearer* the lens — and the first version of this ran to z 3.6, a
metre and a third from a 74° lens. Measured across it, his head projected to
ndcX 1.6 at the near corners: off the side of the screen, feet off the bottom,
and the wide-angle stretch in the corner blowing his head up to something
grotesque. Past z 3.05 there was no x at all where he fitted. It only showed up
once the walk targets got far enough apart to reach the corners. The bounds now
satisfy three things at every corner — floor clear of the counters (by raycast,
since the merged-by-material GLB makes bounding boxes useless), whole in frame on
a portrait phone, and whole in frame on a landscape desktop, which is the one
that caps the near edge.

**How near the camera he comes is a framing limit, not a floor one.** The clear
span (-2.15 to 0.40) holds all the way to z 3.4; what stops him is his feet
leaving the bottom of the frame. Measured, that is just past z 2.6 on a 24 mm
landscape desktop and past 3.9 on a phone, which now carries 25 mm and 2.6 m of
dolly. The near edge is 2.5 — the bound both tiers can keep — which is most of
the depth he had before again. **Give desktop the same lens and dolly pairing and
there is another metre and a half available**; until somebody has looked at
desktop, taking it would mean cropping his feet off there.

Every bound is **his shoulders, not his centre**. The first version sampled the
floor with a single ray under his origin, which walked him to the edge of the
clear floor with an arm through a cabinet — and put his shoulder in the stove at
the far edge. Sampling four points around him at his 0.3 m radius is what set the
final bounds.

### Turning

He has `idle_turn_left` and `idle_turn_right` and nothing was using them: any
change of heading played `walk_fwd_normal` while the root spun, so a 180 was him
moonwalking round on the spot.

They cannot simply be played, because **they bake their rotation into the hips
rather than the root** — 102.6° over 0.97 s, measured off the GLB. Played
straight, the clip turns him *and* the root turns him, twice over, and then it
all snaps back when the clip loops. So `applyRootMotion` moves it across: each
frame it reads the twist the clip put on the hips, adds it to the root, and
cancels it on the bone. Same picture, except now he has actually turned and
keeps it. It must run *after* the mixer, which is why it is a separate call in
the render loop rather than part of `update`.

Details that turned out to matter:

- **Only the twist about world up moves.** The rest of what the hips do — the
  lean into the pivot — is the animation and stays on the bone. And up is found
  by mapping world up *into* the hips' parent frame rather than assuming local
  Y: this armature hangs under a node rotated -90° about X, so local Y there is
  not up.
- **The clip's own curve drives it** — 0, 15, 40, 84, 103° across the clip,
  which is a foot planting and a body swinging round it. Rotating the root at
  some constant rate of our own would slide his feet for the whole turn.
- **Magnitude from the clip, direction from the target.** The clip picked is
  already the right-handed one, so they agree — but taking direction from the
  target means a clip with an unexpected sign still turns him toward where he is
  going rather than away from it forever.
- **One clip's worth, never a loop.** The loop is a seam: the pose at the end of
  a pivot is not the pose at the start of one, so the lean jumps ~10° in a single
  frame. Smoothing that over was tried and was a wash, so instead he pivots up to
  95° and the walking phase steers out whatever is left — which is what a person
  does anyway. Nobody spins 180 on the spot and then sets off.
- **The hips are handed back in proportion to the clip's own weight**, and this
  took three goes. Stop cancelling the instant the turn ends and the clip is
  still fading out at high weight: 76° snaps onto him in one frame. Ease the
  cancellation out on a timer instead and it re-exposes the turn's residual
  faster than the fade removes it — he over-rotates and swings back, measured at
  15–18° right at the seam, which is what the twitch was.
  A cross-fade poses the hips at roughly the turn's twist times its weight, so
  cancelling exactly that tracks the fade rather than racing it: full at weight
  1, nothing at weight 0, continuous at both ends.
  Two things make that exact. The clip's **clock is stopped** at completion —
  it is 0.97 s long and a 95° step reaches its cap at about 0.95 s, a hair
  before it loops, so otherwise its twist snaps from 122° back to zero mid-fade
  and the correction is aiming at a moving target (a 48° lurch, measured). And
  the weight is read **without `isRunning()`**, which is false for an action
  whose timeScale is zero — freezing the clock would otherwise make the
  correction read a weight of 0 and do nothing at all.
  `halt()` does the same, since being interrupted to talk lands mid-pivot.

  Measured across 60°, ±120° and 175° turns, the worst reversal in any 0.25 s
  window is 8–10°, during the walk and idle rather than at the seam — against a
  control of **6.3°**, which is what a plain walk's hips do on their own.

Under 40° there is no step turn at all — he walks the corner, which the walking
phase already steers for.

Measured across 180°, -120° and 20° turns: each lands exactly on its heading,
picks the correct clip, and the worst single-frame movement is 4–6°, most of
which is ordinary cross-fade blending between the pivot and the walk.

`maxFacingAwayDeg` stops him choosing a spot that would turn his back on the
camera, since he is meant to be someone you talk to. The walkable rectangle is in
the panel under *Wandering → walkable floor*, and `wander.halt()` stops him where
he is — that is what the talking code will call.

*Testing this headless:* software rendering runs about one frame every two
seconds, so nothing visibly moves. Step it by hand instead —
`wander.update(1/60); colin.update(1/60); rig.update(1/60)` in a loop.

## Talking to him

> **The face is live.** `colin.glb` is the whole character on one skeleton, so
> the head graft is gone entirely — see **VISEMES.md** for the shape inventory and
> the layer order.

Tap **talk** at the bottom of the screen. That one gesture does two things,
because it is the only one we are guaranteed: it wakes the `AudioContext`
(iOS will not start one without a gesture, and suspends it again whenever the
page loses focus) and it starts speech recognition.

Four pieces that know nothing about each other, and `src/talk.ts` is the only
place their order matters:

| | |
|---|---|
| `src/listen.ts` | the browser's own `SpeechRecognition`. No key, no proxy. |
| `src/brain.ts` | `POST /` to the Worker, streamed, so he can start talking before the sentence is finished. |
| `src/voice.ts` | `POST /speak` to the Worker: his ElevenLabs voice clone. |
| `src/visemes.ts` | the character timings that come back with the audio, turned into mouth shapes. |

Both endpoints are the same Cloudflare Worker, `orb-brain.colinwillowtree.workers.dev`,
carried over from glorp. The Anthropic and ElevenLabs keys live there as
Cloudflare secrets and never reach the page. Its CORS allow-list is
`https://colinwillow.github.io`, which is where this deploys — **so talking works
on the live site and not on a dev server**, unless you widen `ALLOWED_ORIGIN` or
point `?brain=` at something else. `persona: "colin"` is what selects his
personality and his cloned voice inside the Worker.

### The order is the design

1. **Deafen him the moment a sentence lands**, not when the audio starts. The
   round trip to the model is a second or two with the microphone open, and
   everything it picks up in that window belongs to a question already asked.
   `abort()` rather than `stop()`, because stop finalises what is pending —
   which is exactly his own voice coming back through the speaker.
2. **Stop him walking.** `wander.config.enabled = false` plus `wander.halt()`,
   and he turns to face the camera at 90°/s — attention, not a manoeuvre.
3. **Speak, then hand the microphone back** after a 1200 ms echo tail.

Recognition's own `isFinal` waits for the room to go quiet, and a room with a
fridge in it never does, so the end of a sentence is decided here instead: the
transcript has stopped changing for `gapMs` (620 ms).

### When he hears himself

He did, and the symptom was unmistakable: he answered as if he were being
repeated back at himself. Two causes, and the second is the one worth writing
down.

**The meter's microphone stream asked for the echo canceller to be off.** All
three constraints were switched off together on the grounds that all three are
"processing" — and that was wrong. Noise suppression and AGC act on *your*
voice, which is what the meter is drawing, so they stay off. Echo cancellation
subtracts the audio the page is *playing*, which is a different job and does
nothing to anybody's dynamics. And it is not local: iOS runs one audio session
for the whole page, so one un-cancelled capture takes the canceller off the
speech recogniser too. One flag.

**The timing gates alone were never going to hold**, whatever the canceller
does. They assume recognition hands over an utterance promptly, and it does not
— it holds one open until it decides it has finished, so audio picked up while
he was talking can arrive *seconds* after he stopped, by which time the mute,
the swallow window and the echo tail have all expired. So `listen.ts` keeps the
last few things he said and drops a sentence that lines up with one of them.

The match is a **longest common subsequence over the heard words**, needing 70%.
In order is what makes it safe: recognition of his own audio gives a different
transcript than the text that was spoken — it drops words, splits contractions
and runs sentences together — so an exact match catches almost nothing, and a
bag-of-words match catches ordinary agreement ("yeah, the kitchen"). A
subsequence is loose about the gaps and strict about the order, which is the
shape a garbled recording of a known sentence actually has.

A filter in front of the model can eat real speech, which is a worse bug than
the one it fixes, so `npm run echo-check` is mostly the rejection table:
agreeing with him, asking about the thing he just mentioned, and quoting him
back on purpose all have to survive. It also caught a real one — his written
lines carry a typographic apostrophe and recognition returns a straight one, so
"I’m" was being split into two one-letter tokens and thrown away, and a
three-word greeting arrived as one word: not enough to identify, so a genuine
echo went through.

### Why the mouth is timed from the text

Driving a mouth off the live waveform is the obvious approach and the weaker
one: a level meter knows how loud he is, not what he is saying, so you get a jaw
flapping in time with the syllables and forming none of them.

ElevenLabs returns a start and an end time for **every character it spoke**
alongside the audio (`marks: 1`, about a third more bytes). That is the real
thing: silent letters get a near-zero span, and letters sharing one sound get
spans that abut, so "ough" collapses into one hold instead of four flickers. The
level is then used for one job only — closing the mouth in the gaps, since a
written sentence has no silences in it.

The shapes are the Preston Blair ten (`AI E O U WQ L FV MBP etc rest`), which is
why there is an `etc` (every consonant the mouth barely changes for) and a
`rest`. **A viseme is never worth deleting**: dropping anything under the minimum
hold killed the "I" in "Hello, I am" — one character, 40 ms — and the face went
dead on exactly the words a face should be most alive on. Rests are the
compressible thing, so short rests are absorbed and short visemes borrow time
from a rest beside them. Total length is untouched, so the audio stays in sync.

Three rigs are matched against whatever the mesh has, best fit first. A
**sculpted nine** (`viseme_MBP`, `viseme_AI`, …) wins outright when it is there:
the shape *is* the mouth position at weight 1, so nothing is reconstructed,
calibrated or mixed, and the separate jaw channel switches off because the shape
carries its own jaw. That is the set in VISEMES.md and where this is heading.

Failing that, `colin.glb`'s head ships Character Creator's own visemes — shapes that *are* the
vowels — so the rig maps straight onto them. Two things are measured rather than
assumed:

- **The jaw is a shape, not a bone.** The armature in the file is a few joints
  baked in so the graft has landmarks, and the jaw among them carries no skin
  weight. The file has both `Jaw_Open` and a custom `jaw_open`; the custom one
  moves twice as far, and it is picked by reach.
- **A weight in the rig is not a distance.** `MBP` is `V_Explosive` at 1.00 plus
  `Mouth_Close` at 0.60, and those numbers were chosen on a different face. On
  this one `Mouth_Close` is among the largest shapes on the mesh, so the same
  0.60 hauls the bottom lip over the top one. The mouth is measured at load and
  any overshoot comes out of the single shape doing the most lifting — not all
  of them, or the press that makes an M an M goes too.

Any shape that is commanded is reached fast and only the drift back to neutral is
lazy: closing your lips is a movement, not a relaxation, and easing both ways
left the jaw degrees open through an M.

### The meter along the bottom

**Three lines, one per third of the spectrum**, and each of them is doing four
things at once:

| | |
|---|---|
| amplitude | that third's energy |
| shape | the eight sub-bands inside it, so the line deforms rather than slides |
| pitch | tightens with the spectral centroid — bright sounds wiggle faster |
| speed | kicks on spectral flux, so consonants and plosives land |

The bottom line is the chest of a voice, the middle its body, the top its
consonants. They are held apart while it is quiet — three lines with nothing to
say sit on exactly the same path and read as one thick line — and the spread
closes as the amplitude that distinguishes them takes over. A row of bars was
the version before this one, and a row of bars is a level display: it can be
taller or shorter and that is the whole of what it can say. Three lines can
disagree with each other.

**Both halves are real.** His comes off the analyser the voice already has on the
way to the speakers; yours comes off `src/mic.ts`. When the microphone is refused,
or the browser has none, it falls back to the recogniser: words arriving push it
up, silence lets it fall, and it looks like the guess it is.

#### The floor is the room, and it moves

This is the part that actually made it reactive, and it is all in `src/audio.ts`
— ported from the orb in `colinwillow/glorp`, which has had it right for a while.

A meter keyed to a FIXED threshold is wrong in both directions at once. In a
quiet room the needle sits a quarter of the way up doing nothing, and a normal
speaking voice — about -30 dBFS at arm's length, a few dB over the ambient — uses
a sliver of the range. So the floor is measured instead, as **the 20th percentile
of the last four seconds**.

A percentile, specifically, rather than a minimum. A minimum tracker is pinned by
one quiet instant — a gap between two words, a moment of gain riding — and stays
there. The 20th percentile is the *room*: while nobody is talking that is the
air, and while somebody is talking it is still the air, because the gaps between
words are more of the take than the words are. Speech cannot desensitise it and
one quiet frame cannot deafen it. It is sorted at 10 Hz rather than every frame,
because the room does not move fast enough to care and a 240-element sort per
frame on a phone does.

Above that floor, 2 dB of margin rejects the room and 18 dB more reaches full
scale. Both are small on purpose: against a floor that IS the room, a phone at
arm's length reads about 6 dB over it, and the large numbers that work against a
fixed floor throw the entire voice away.

Two consequences worth knowing:

- **The microphone asks for RAW audio, except for the echo canceller** — noise
  suppression and automatic gain are off, because both flatten exactly the
  dynamics being drawn and AGC in particular pushes a whisper and a shout to the
  same level. What makes raw usable is the moving floor. Echo cancellation is
  on, and used not to be; see *When he hears himself* above for what that cost.
- **Both analysers are read every frame**, whoever is talking. An analyser that
  is not being drawn still has to keep its history moving, or the floor restarts
  from nothing at every change of turn and the first second of every sentence is
  wrong.

### He starts talking before he has finished thinking

The pause before a reply used to be three waits end to end: the model thinking,
the model *finishing*, and then the voice rendering. The first sentence of a
two-sentence answer exists a long time before the second one does, and there is
nothing to be gained by sitting on it.

`voice.open()` returns a handle that can be pushed to while the reply is still
streaming; `talk.ts` cuts the stream at each finished sentence and hands it over,
so the rendering of the first overlaps the writing of the rest. One consumer loop
renders the queue in order, and that is not incidental — each request is
conditioned on the text before and after it, which is what keeps the prosody
continuous across a seam.

**The seam has to include the end of what has arrived so far**, and that one
character is the whole feature. Requiring whitespace after the full stop sounds
right and is wrong for a stream: the space belongs to the *next* token, so a
finished sentence does not look finished until the model has started writing the
one after it — which is exactly the wait being removed. Measured against a Worker
that pauses a second between sentences, requiring the space gave up the entire
second. `scripts/latency-check.mjs` is that measurement, and it failed the first
version of this.

Each turn logs where its time actually went:

```
turn — first word 380ms · first sentence sent 910ms · talking 1620ms · reply written 2240ms
```

`talking` is the one you feel. Everything left in it is the model's time to first
token plus one voice render, and neither of those is the page's to shorten — the
levers for those are in the Worker.

### Captions are off until you ask

A conversation is meant to be heard. A running transcript over the top of it
turns him into a screen with a video on it — the words arrive in his voice, and
the subtitles are for the times that is not enough. The toggle sits in the dock
and the choice is remembered; tapping the text puts it away, which is where
anyone annoyed by it is already looking.

There is **no bubble** behind the words. A panel is a subtitle track; this is him
talking with a transcript available. The text sits on the room and carries its
own halo — a tight bright shadow for contrast against anything pale and a wider
one for anything bright — which is what lets the same treatment work on a white
sweep and in a dark kitchen.


### Checking it without the network

`scripts/talk-check.mjs` runs the whole pipeline in headless Chromium with the
Worker stubbed — a streamed reply and a tone with a plausible character
alignment — so no key, no microphone and no network are involved. What it
actually tests is the part that is ours: the chat body, the audio scheduling,
the timeline, and whether the mouth on the real head moves.

```bash
npm i -D playwright && npx playwright install chromium   # not a project dependency
npm run build && npx vite preview --port 4173 &
npm run talk-check -- http://127.0.0.1:4173/
npm run mic-check -- http://127.0.0.1:4173/        # the push-to-talk path
npm run latency-check -- http://127.0.0.1:4173/    # does he start before the reply ends
npm run command-check -- http://127.0.0.1:4173/    # does he do what he is told, and only then
npm run mood-check -- http://127.0.0.1:4173/       # does he feel anything, and does it show
npm run echo-check -- http://127.0.0.1:4173/       # does he hear himself, and only himself
```

It stops the render loop before it samples: software WebGL draws about one frame
every two seconds and blocks the main thread doing it, which starves the sampler
and would prove nothing either way.

### Testing it without a microphone

The tuning panel has a **Talking** folder: type a line into *say to him* and
press *send*. It takes exactly the path a spoken sentence does, minus the
recogniser, and asks for no permissions at all. From the console,
`talk.say('...')`, `talk.voice.stop()` and `talk.brain.forget()`.

### How he is feeling, and what it makes him do

`src/mood.ts`. The old version read six keywords off an exchange, picked one of
six names and threw it away on the next turn — so he had no memory of being
insulted, no way to be *slightly* pleased, and nothing that could build. You
could call him an idiot four times running and get the same flicker of a frown
each time.

**It is two numbers and some inertia**, which is most of what a mood is:

```
valence  −1 hurt  ……  0  ……  +1 delighted
energy   −1 flat  ……  0  ……  +1 wired
```

Two axes rather than one slider because the pair is what separates the feelings
that matter. **Sad and cross are both unhappy and they are not remotely the same
face** — sad is low energy, cross is high — and content and delighted are the
same difference the other way up. One slider can only go from frown to smile,
and he could never be annoyed.

Everything said moves them a little and nothing snaps, so four insults land four
times harder than one, and it all drifts back toward level on its own — a
105-second half-life for the mood, 55 for the energy, because energy settles
faster than mood does in people too. That decay is most of what makes it read as
a mood rather than a state machine.

**His face is a blend of the two, every frame.** Four corner poses and the
middle of the top edge — a grin, a small warm smile, a scowl, a sad face, and
wide-eyed — mixed by where the numbers are, so half a smile is genuinely half of
those weights and pleased-but-tired lands between the grin and the quiet one.
This runs *under* the transient expressions rather than instead of them: an
expression is a beat and a mood is a state, and a face that only does
two-second beats and returns to dead level between them is a face nobody is
behind.

The amplitude dial (`alive.config.feeling`) defaults to **1.5, above one on
purpose**. Measured across a rendered frame, a full smile on this rig changes
19% of the pixels on his face and a full brow drop changes 12% — so at the
authored weights a strong mood came out as a clear grin and two kinds of
almost-nothing, with cross and sad indistinguishable. What the gain really buys
is the middle of the range; the strongest shapes clip at the extremes, which is
the right trade.

**And he does things nobody asked for.** `commands.ts` has the other end of the
same machinery: `match` is him being told, `suggest` is him deciding. Mention a
song and he might start dancing; mention the gym and he might break into a run.
*Might* — a reaction that fires every time is a command with extra steps, and
the fastest way to make a trick tiresome. Each cue carries its own odds (a song
is about 55%), it only ever picks a move the export can actually do, nothing is
said over it (a man who announces that a song made him want to dance has ruined
it), and there is a **38-second floor between two of them** or a conversation
about music is a man who never stops dancing. It fires when the voice stops
rather than when the sentence lands: breaking into a dance mid-word looks like a
bug, and doing it just after he finishes looks like a thought.

The mood also rides along with every question to the model, as `state.mood`, so
four insults in a row do not get the same breezy line he would have written
first thing. `persona/colin.md` says what to do with it.

`npm run mood-check` is the harness: that a remark is a lean and four are a
lurch, that it wears off, that the four corners are measurably different faces
on the real morph targets, and that twelve songs in a row produce exactly one
dance.

The Mood screen is **two sliders and six shortcuts to positions on them**, with
a reading of where he has actually drifted to — because the conversation is
moving the same two numbers the whole time, and a preset that stays lit while he
has wandered off is a lie.

### Telling him to do something

`src/commands.ts`. "Do a dance" used to go to the model like any other
sentence, and the model — which cannot move him — answered **"like this"** over
a man standing perfectly still. That is worse than no answer at all: a claim
with nothing behind it.

**So an order never reaches the model.** It is matched on the page, and the clip
starts on the frame the sentence lands. That is not only more honest, it makes
an order the fastest thing in the app — no round trip to think, none to write,
and a line that was already on the device. Both halves still go into the
transcript, because the next thing anybody says is usually about what just
happened ("that was terrible") and a model that was never told there was a dance
has nothing to be rude about.

**What he can do is read off the export, never written down.** Each move names
the clip it wants as a *pattern*, and a move whose pattern finds nothing is not
an error — it is something he cannot do yet, and he dodges the question instead
of admitting it. Which is why the table has entries for moves the file has never
had: drop a backflip into `colin.glb` and *"do a backflip"* starts working with
nothing in the code to change.

Today the export carries twelve he can actually do — `moonwalk, twerk, hiphop,
wiggle, dance, wave, kneel, tired, sulk, swagger, tiptoe, run` — and seven he
covers for: backflip, cartwheel, jumping, press-ups, throwing hands, a spin,
clapping. Ask *"what can you do"* and he reads the list off the file, so the
answer stays true through a re-export. Moving — *come here*, *back up*, *walk
around* — goes through the wander instead of a clip, because every walk in the
file is an in-place cycle and the wander is the only thing that moves him across
a floor. In a studio, where there is no floor to cross, being sent anywhere
becomes a refusal.

**The rejection half is the dangerous half.** This sits in front of the model, so
every false positive is a conversation replaced by a moonwalk — and *"do you like
dancing"* is one word away from *"do a dance"*. A sentence counts as an order
only if it is short enough to be a bare instruction or carries one of the words
people put in front of one, and never if it is about the speaker: *"I can dance
too"*, *"she loves to dance"*, *"my sister does hip hop"* all go to the model
where they belong. `npm run command-check` is the table of both halves.

What he says over the top comes out of a bank at the bottom of that file, for
the same reason the greetings do — these are voice, not conversation, and a
round trip to be smug is a second and a half. **Narration is banned**: "like
this", "here you go", "watch me", because the move is already happening on
screen and saying it out loud is the exact thing that was wrong. What is left is
somebody who has been asked to prove he can do something obvious — *Obviously.
No duh. Yeah, I'm not an idiot. Was that meant to be difficult?* — and, for the
moves he has not got, a way out: *I did. You blinked. / Not in this room.
Insurance. / Physically capable. Emotionally, no.*

`persona/colin.md` carries the same rules for the sentences the matcher lets
through, so an order phrased sideways gets the same treatment from the model.

## Lighting experiment: real lights instead of the bake

`src/roomLights.ts`, off by default, in the panel under *Lighting experiment →
real lights (bake off)*. It sets every lightmap to zero and lights the room with
four lights instead: a warm hemisphere, a directional sun, a point light at the
pendant's actual bulb (there is a real `Bulb_Glow` emissive in the GLB at
-1.55, 2.25, 2.55), and a soft fill standing in for the fourth wall that is not
modelled. Nothing is destructive — the lightmaps stay attached and are only
turned down, so the toggle is instant both ways.

**The bake wins on looks and always will.** It is path-traced GI with hours of
Blender behind it, against four lights and a shadow map. What it cannot do is
*change*: the lightmaps are a photograph of one lighting state, so a light
switch, a time of day, or a lamp Colin turns on each need another bake. That is
the trade this makes visible.

The first attempt came out cooler and harder than the baked room, for the
obvious reason — four lights have no bounce, and the bake is nothing but bounce.
The fix was to stop asking the lights to supply it: **the HDR probe was shot
inside this kitchen**, so it already carries the warm walls, the colour bleeding
off the wood, and the soft wrap. Turned most of the way up (`envMapIntensity`
1.7, against the bake's 0.25) it stands in for the GI and the lights only do
direction and the bulb, which is the part they are good at. Ambient down at 0.2,
sun at 1.6.

Sun shadows are a switch of their own, since they are the expensive part —
enabling them turns on the renderer's shadow map and marks all 82 room meshes as
casters and receivers, and the flag is dropped again when the experiment is off
so the character pass never pays for it.

## Him, and nothing else

The app opens on `stage`: the room, the man in it, a caption, the meter, and one
chip in the corner. No tab bar, no floating buttons, nothing laid over his face.
Everything the *app around him* section describes is still there and is one chip
away — it is a workshop you go into deliberately and come back out of.

That is the whole reason the default changed. A tab bar along the bottom of the
first thing you see makes it an app with a character in it. This way round it is
a character, with an app folded up behind him.

### The front door

Not a splash screen — a gesture collector with a face on it. Audio will not start
without a tap, the microphone will not open without a tap, and the speech
recogniser will not start without a tap. So there *has* to be one; the only
choice is whether it is a button labelled "talk" tucked in a corner, or the first
thing you see. Making it the first thing you see is what turns "open the app,
find the control, press it" into "open the app and he says hello".

Everything the app needs comes out of that single tap, in this order, because the
order is load-bearing on iOS:

```
voice.arm()          build the AudioContext — needs the gesture
mic.open(context)    ask for the microphone — the prompt suspends the context
voice.arm()          resume it, free when it is already awake
speak(greeting)      he says something
openEars()           and only then does the recogniser start
```

It shows on every load, and that is not a missing "remember me": a browser will
not carry an audio grant across a page load, so there is nothing to remember —
and somebody who wanted to be talked to is not annoyed by being asked whether
they want to be talked to. **Just look around** skips the lot.

## His look

*More → His look*, or the Look tile on the hub. Brightness, the three lights,
roughness, emission, environment, saturation, and how bright the backdrop is —
with him standing there while you drag.

The defaults are **not neutral ones**. They were dialled in on a phone, on the
Paper backdrop, and then written into `DEFAULT_LOOK`: nearly three times the key
light, half again the fill, emission at 250%, and roughness at 0.8 — matching
the Blender setup rather than the scene table's 0.61. That table was tuned
against a dark baked kitchen where he needed almost none of this, and standing
on a pale sweep is a different problem. *Reset* means back to those, not back to
whatever number happens to be in the GLB.

The storage key carries a version (`colin.look.v2`) and **it has to be bumped
whenever those defaults change**. The saved object wins every key it has, which
is every key, so a new default otherwise lands on a device that has never run
the app and on no other one.

**The room sets the baseline and this sets the taste.** That distinction is the
whole design. `stage.ts` writes exposure, emission, environment and the three
light intensities on every change of room, because a baked kitchen and a white
sweep want nothing like the same numbers — so anything adjusted by hand used to
be correct until the next room and then silently gone. Every knob here except two
is a **multiplier** on whatever the scene asked for, so "a bit brighter" stays a
bit brighter everywhere, including in rooms added later. The two absolutes are the
two no scene has an opinion about: how rough his surface is, and how saturated.

Two implementation notes:

- **Saturation is applied in linear light, before the tone curve.** Afterwards it
  fights the curve's own desaturation of the highlights and turns the bright end
  plastic; before it, it behaves like a property of the material — the way it
  would if the texture had been painted that way.
- It rides on the patch in `toon.ts`, because **that is the only
  `onBeforeCompile` his materials get** and a second module setting one would
  silently replace the first. `look.ts` owns what the number is; `toon.ts` owns
  where it lands in the shader.

Nothing in a slider's `input` handler rebuilds the screen, which sounds obvious
and is the bug that got written first: refreshing the tray from inside a drag
replaces the element the thumb is on, and the drag ends on the frame it started.

## Black, cream and beige

The interface has no fourth colour. Everything selected used to be blue, and
against a warm sweep that reads as a control panel bolted onto a photograph — so
selection is now weight and a darker edge rather than a hue, which is how print
does it and what leaves the palette alone. The microphone is a cream pill when it
is off and solid ink when it is on; there is no accent colour anywhere.

The surfaces are **semi-opaque with very little blur**, which is a different thing
from the frosted glass they were: closer to waxed paper — you can tell there is a
room behind them without being able to read it. The alpha is still the contrast
budget, so there is a floor under how far that can go before dark text on the
Slate backdrop stops working.

The meter takes its hues **off his jacket**. That coat is the most interesting
thing on screen — rust, ochre, a mauve, a teal — and the three lines under him
were painted from a palette somebody picked by eye, which is a match that has to
be maintained. `src/palette.ts` reads the outfit texture instead, so the two
agree by construction and keep agreeing through a re-export with a different
coat, with nothing here to edit.

What it looks for is **not the average colour**. The average of that sheet is
mud: it is a whole outfit on one texture, mostly beige hoodie and navy jeans, and
averaging a rust next to a teal gives grey. Pixels are bucketed by hue and
weighted by saturation, with the very light and very dark thrown out as
highlights and shadows of some other colour, and neighbouring buckets collapsed
so a gradient cannot win three places with one hue. Off the current model that
finds six: `#bb8975 #405a81 #7d535f #477985 #afa587 #645972`.

**The ladder is the legibility and the hues are the decoration.** The three lines
stay at fixed values — dark, mid, light — whatever comes back, because the darkest
survives anything pale, the lightest survives anything dark, and the middle is
held well clear of the beige backdrop: a line the same value as what is behind it
is not a line. Sampling decides which colour each one is, never where it sits.
Saturation is a **ceiling rather than a target**, which is most of the character:
forcing the sampled hues up to a fixed number turned the jacket's mauve into
bubblegum, so each line keeps its own swatch's saturation unless the rung will
not take it. Whose turn it is still comes through as temperature — the warm half
of the coat is him talking, the cool half is you, and neither leaves the garment.
If the texture cannot be read back at all, nothing comes back and the original
ink-and-cream palette stands. The glow behind the lines stays paper-coloured
rather than coloured, so it reads as legibility rather than as neon.

## The other way he could look

A switch, not a decision. `src/toon.ts` installs a patch on his materials at
load and drives it from a uniform, so turning it on is an assignment rather than
four hundred recompiled programs, and at `amount: 0` what comes back is exactly
the physically-based render this shipped with. *More → Toon shading* is the
switch; the tuning panel's **Toon** folder has all ten numbers live.

Four things together are what read as cel shaded, and only the first is the one
people name:

| | |
|---|---|
| the ramp | direct diffuse light in steps instead of a gradient |
| the rim | a lit edge where the surface turns away from the lens |
| the outline | an actual ink line, from a back-facing hull one size up |
| the glow | the texture lifting itself, so colour looks emitted |

**What makes the look is steps, not brightness.** A sphere under a smooth falloff
reads as a sphere however bright it is; what makes it read as a *drawing* is that
the gradient is thrown away and replaced by flat regions with a hard edge
between them. So the number that matters is `bands`. The `floor` is the other
half: the darkest band never falls to black, it keeps a fraction of full light,
so a toon shadow on a red coat is still red.

Three things about the implementation are worth knowing, because each of them
was a wrong version first.

- **The ramp goes on the diffuse irradiance, not on `dotNL`.** `dotNL` in three's
  chunk feeds the specular term as well, so ramping it bands the *highlights* —
  which on a roughness-0.75 face is a set of hard white blobs sliding around his
  forehead, the exact opposite of flat. Ramped one line later, the light lands in
  steps and the specular stays a highlight.
- **`customProgramCacheKey` is not optional.** three builds a program cache key
  out of a material's parameters and nothing else — `onBeforeCompile` is not in
  it — so two materials with identical parameters share one compiled program and
  whichever compiled first decides for both. Without the key the patch reaches
  some of him and not the rest. (This is the same trap `colinwillow/plutopia`
  documents, and where the ramp itself came from; it is on r128, where the
  lighting chunk still said `geometry.normal`. Every substring here was checked
  against the pinned r185 in `node_modules` — each occurs exactly once.)
- **Emission is capped rather than scaled.** He carries his diffuse map back as
  emission to hold his level up in a dark baked kitchen — 0.72 there, 0.3 in a
  studio. Stacked under a raised floor the kitchen's value blows him out. A flat
  multiplier tuned against 0.72 also cuts the studio's 0.3, and the comparison
  the feature exists for turns into "the toon one is darker"; a ceiling leaves
  any room already under it alone.

The ink line is a back-facing copy of him one size up — the cheap trick, and
still the right one here: no second pass, no depth buffer to sample, and it
follows the skeleton and the blend shapes for free because it *is* the same
geometry bound to the same skeleton. It is pushed along the normal in view space
and scaled by depth, so the line is a constant thickness on screen. His eyes and
teeth are left out of it, an outlined eyeball being a black ring in the middle of
his face.

Its one real limitation shows on his hair: a hull pushed along the normals opens
up wherever the normals are split, so a low-poly shape with hard edges gets a
faceted line rather than a smooth one. The fixes are a normal-smoothed copy of
the geometry or a screen-space edge pass, and neither is worth doing until the
look itself is chosen.

## The app around him

He is the page. Everything else is arranged around him — a header, the space
either side, a tray underneath, a tab bar — so choosing a jacket happens while
looking at the jacket. Only the three screens that are genuinely not about him
take the whole display: the gallery, the camera roll's viewer, and settings.

```
Home      him, and six ways in
Outfits   slots down the right, what is in the slot along the bottom
Poses     every clip, grouped; Hold freezes a frame, Save keeps it
Mood      what he is like, which picks his idle and sets his face
Emotes    one thing, once: a wave, a raised brow
Rooms     the kitchen, or a studio sweep in five colours
Camera    a viewfinder with four framings and a shutter
Gallery   what the shutter kept, with share and delete
More      captions, resets, the tuning panel, what he is made of
```

**Talking is the middle of the tab bar**, not a screen. It is the point of the
app, and the point of the app should not be three taps away.

### Nothing here is a fixed list

Every screen reads the model rather than a table that has to be kept in step
with it.

- **Outfits** walks the export for meshes that are not his body. The slot comes
  from the mesh's own name — `top_flannel`, `shoes_vans`, `hat_beanie` — so a new
  wearable is an export away from appearing, with nothing to edit here. Names
  that predate the rule (`converse`, `outfit`, `headphones`) are mapped by hand
  in `src/wardrobe.ts`. A slot nothing landed in is still shown, with the name to
  give the mesh that would fill it.
- **Poses** are frames, not assets. Pick a clip, stop its clock, and the frame it
  stopped on is a pose — which means every animation exported from Cinema 4D
  arrives carrying a few hundred of them. Saved poses are `{ clip, time }` in
  `localStorage`, and one whose clip has left the export quietly stops existing.
- **Moods** are the six in `src/mood.ts`, and picking one re-picks his idle
  immediately rather than waiting for the current one to finish.

### An empty warm room

**This is what the app opens on** — Paper, a warm off-white sweep. The kitchen is
the better piece of work and is one tap away in Rooms, but a plain bright space
is the right thing to look at while you are talking to somebody: nothing in it
competes with him, and it reads as a place he is rather than a set he is standing
on. Warm rather than white because skin on a cold white sweep goes grey, and
because the entire interface is now built out of the colours in it.

Making it read as a *place* is one thing and one thing only: a shadow on the
floor that is the shape of him. The blob under his feet is a good cheat against a
baked kitchen floor, where it only has to say "he is touching the ground". On an
empty white plane it says "someone has put an oval here".

So `src/ground.ts` is a real one — a light above him, a shadow map, and a plane
that is invisible except where the shadow lands. `ShadowMaterial` renders nothing
but the shadow, so the sweep behind it comes through untouched and there is no
horizon line where the floor ends, which is what makes it an infinite space
rather than a room with a white wall in it. The sweep barely darkens toward the
bottom for the same reason: a visible gradient draws a horizon, and the shadow is
what is supposed to say there is a floor.

Three things that were wrong first:

- **`PCFSoftShadowMap` is a trap in r185.** The shadow-type defines map only PCF
  and VSM now, so the soft constant falls through to `SHADOWMAP_TYPE_BASIC` — a
  single hard tap that ignores `radius` entirely. Asking for the softest setting
  in this version gets you the hardest one. It is `PCFShadowMap` plus a radius,
  here and in the room-lights experiment, which had the same bug.
- **`shadowMap.enabled` is a global that two features both wanted.** Each of them
  switched it off when idle, so they turned each other off. It is enabled once
  and left alone — a shadow map with nothing casting into it costs nothing — and
  which lights actually cast is the per-light flag.
- **The shadow camera follows him**, because it is only 3.2 m across and the
  quality of a soft shadow is texels per metre. The light is *moved*, not
  re-aimed, or the shadow would swing around him as he walked.

The blob is not deleted, just turned down to a whisper in a studio: it darkens
the last centimetre under his soles, which a shadow map at this resolution cannot
resolve and which is most of what sells contact.

### Every backdrop was black on iOS for a fortnight

Worth writing down, because nothing about it was visible from here and the
failure mode is silent by design.

The sweep was a `FloatType` DataTexture with `LinearFilter` on it. **Linear
filtering of a 32-bit float texture needs `OES_texture_float_linear`, and Safari
does not expose it.** A texture whose filter the driver cannot honour is
*incomplete*, and an incomplete texture samples as solid black — it does not warn,
does not throw, and renders perfectly in every desktop browser. Every studio
looked right in Chromium and every one of them was a black screen on the phone.

It is an 11 KB colour ramp. There was never anything float about it worth having,
so it is eight-bit sRGB now, which needs no extension at all. The three driver
facts that have actually cost something are printed in **More → About**, because
the device where this goes wrong is a phone and nobody is opening a console on a
phone.

### The backdrop is also the light

A studio is not the kitchen with the walls hidden. The sweep behind him is
generated as a one-pixel-wide vertical gradient, used as the backdrop *and*
pre-filtered into the environment map — so the colour on the wall is the colour
falling on his face, which is the entire reason a white cyc and a black one look
nothing alike. Exposure, emission, the three character lights and the contact
shadow all move with it; the numbers are one table in `src/stage.ts`.

**The sweep is a sphere, not `scene.background`.** A scene background goes
through the tone curve, and the room's curve is AgX at 0.55 exposure — which
turned a white cyc into mid grey and a slate one into black, because compressing
highlights is exactly what that curve is for. A mesh can opt out with
`toneMapped: false`.

### Framing is solved, not dialled in

`src/shot.ts` takes the camera off the rig and puts it on a mark. A shot says how
many metres of world it wants to see top to bottom; the distance follows from the
lens and the viewport:

```
d = coverM / (2 · tan(fov / 2))
```

which is what makes one set of numbers frame him the same on a phone in portrait
and on a laptop. Two things feed into it that are worth knowing about:

- **He is framed from his hips, not his root.** A clip that lunges toward the
  camera moves his hips a metre and leaves the root where it was, and a camera
  locked to the root turns that into a close-up of his forehead. The anchor is
  damped over about 0.7 s, so it follows where he has got to rather than what he
  is doing.
- **He is framed inside what the interface is not covering.** The tray on Poses
  is three rows deep and the one on Home is nothing at all, so the shell measures
  its own chrome after every layout and hands the camera two fractions. The
  camera opens up by that much and tilts down by half the difference, and he
  lands in the middle of what you can actually see. No margins per screen.

Drag anywhere on the render to turn around him; the wheel pushes in.

### Photos

The picture is the canvas, and every control is a DOM overlay the drawing buffer
has never heard of — so there is no chrome to hide before a shot, and what you
see is what is saved. The capture is a flag rather than a call: a WebGL drawing
buffer is only readable in the tick that drew it, so the render loop reads the
pixels at the bottom of the frame. Asking for `preserveDrawingBuffer` instead
would cost a full-screen copy on every frame for the sake of one button.

They go in IndexedDB, full size and thumbnail, because a phone screenshot is a
megabyte or two and `localStorage` gives you five in total — as strings, which
costs another third on top. **Save** goes through the share sheet, which is the
only route to the camera roll on iOS; everywhere else it downloads.

### Looking at it without a screen

`scripts/ui-tour.mjs` walks every screen at phone size and writes a PNG of each,
failing if anything throws on the way in or out.

```bash
npm i -D playwright                                      # not a project dependency
npm run build && npx vite preview --port 4173 &
npm run ui-tour -- http://127.0.0.1:4173/ .tour
```

## Interactive objects

These are separate meshes, and each pivot is placed where the object naturally
moves. The loader returns them as `interactive[name]`.

| Name | Pivot | Future use |
|---|---|---|
| `Fridge_Door` | Hinge edge, right side of the fridge, bottom of the upper door | Rotate about Y to open. Test which sign swings it toward the camera |
| `Fridge_Body` | Base center | Static counterpart to the door |
| `Stove_OvenDoor` | Bottom front edge of the oven | Rotate about X to drop open |
| `DutchOven_Pot`, `DutchOven_Lid` | Bottom center | Pick up / lift lid |
| `Pendant_Lamp` | Ceiling mount | Can swing; the bulb is emissive |
| `CopperSkillet`, `CopperSaucepan` | Near the bottom center | Pick up |

These objects' lightmaps were baked at their rest positions. When one moves far,
such as a pot carried across the room, set its `lightMap` to null and raise its
`envMapIntensity` to about 1 so it is lit by the probe like the character.

## Tuning knobs

**The panel is off by default.** It was the only way to reach any of this when it
was the only interface there was; now that there are real controls it is a
developer tool, so it lives behind *More → Tuning panel*, or `?tune` in the URL.

All five are live in that panel; "log settings to console" prints the current
values so they can be written back into the code or the manifest.

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

## Add to Home Screen

`public/icons/` plus `public/manifest.webmanifest`. Tap share → *Add to Home
Screen* on iOS and it installs as **Colin**, opening without Safari's chrome.

**The icon is full-bleed and square on purpose.** iOS lays its own superellipse
mask over whatever it is handed, so corners rounded in the file get rounded
twice and the gap between the two radii shows as dark wedges. The source art had
a 28.6% radius baked in — rounder than the mask — so it is cropped *inside* that
arc (94 px on each side of the 1085 px square, which is `r × (1 − 1/√2)`, the
point where the corner arc stops eating the frame) rather than used as-is.

The Android maskable icon is a separate file, inset to 78%, because that mask is
a circle keeping only the middle 80% and it would otherwise crop his headphones
off.

`apple-mobile-web-app-capable` is what makes it launch standalone — iOS still
reads only the prefixed spelling, so both are present. The status bar is
translucent so the room runs under the clock, and the tuning panel carries a
`safe-area-inset-top` margin to clear it.

The tab favicon is still the little SVG kitchen glyph: at 32 px his face is mush.

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

1. ~~**Mobile GPU memory.**~~ Done — see *Asset sets* above.
2. **Interactions.** Sit anchors on the chairs, door hinge animations for the
   fridge and oven, pick-up targets for the pot, lid, mug, and pans, and pathing
   for the character.
3. **Light switch.** Colin can bake a second lightmap set with the lights off.
   Crossfade between the two sets in a shader, or by swapping textures while
   fading intensity, and dim the pendant bulb's emissive at the same time.
4. ~~**The face, voice and visemes.**~~ Done — see *Talking to him* above. The
   Worker still lives in `colinwillow/glorp` under `worker/`; nothing about it
   had to change, since the kitchen deploys to the same origin its CORS
   allow-list already names.

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
