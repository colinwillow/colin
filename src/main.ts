// Renders the baked kitchen from its reference camera, with a small mouse sway.
// The character (from the Orb/glorp project) drops in later — see CHARACTER_SPOT.
import * as THREE from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import {
  loadKitchen, fovForLens, lensForFov, type FramingMode,
} from './kitchenEnvironment';
import { createCameraRig, DEFAULT_RIG } from './cameraRig';
import { createWander, DEFAULT_WANDER } from './wander';
import {
  createFaceRig, createAlive, DEFAULT_ALIVE,
  type FaceRig, type Alive, type ExpressionName,
} from './face';
import { loadCharacter, createCharacterLights, type Character, type CharacterLights } from './character';
import { pickQuality, QUALITY } from './quality';
import { createRoomLights, DEFAULT_ROOM_LIGHTS, type RoomLights } from './roomLights';
import { createConversation, type Conversation } from './talk';

/** On the rug in front of the stove, where the HDR probe was rendered. */
export const CHARACTER_SPOT = new THREE.Vector3(-0.3, 0, 1.7);

/** Larger than life on purpose: at his measured height he reads as a small
 *  figure at the back of a wide room. */
const CHARACTER_HEIGHT = 2.1;

/**
 * Where the assets live. '/' in dev, '/<repo>/' on GitHub Pages — every asset
 * path has to go through this or it 404s once deployed under a subpath.
 */
const ASSETS = import.meta.env.BASE_URL;

/** Set by the panel: one shape it wants held open, re-asked for every frame
 *  because the compositor clears what it is not told again. */
let held: () => void = () => {};

/**
 * The Cloudflare Worker that holds the keys: Claude on `POST /`, the ElevenLabs
 * voice clone on `POST /speak`. Nothing secret ever reaches the page.
 *
 * Its CORS allow-list is `https://colinwillow.github.io`, which is where this is
 * deployed — so talking works on the live site and not on a dev server, unless
 * the Worker's ALLOWED_ORIGIN is widened or `?brain=` points somewhere else.
 */
const BRAIN = new URLSearchParams(location.search).get('brain')
  ?? 'https://orb-brain.colinwillowtree.workers.dev';
/** Which character the Worker answers and speaks as — see CASTS in the Worker. */
const PERSONA = 'colin';

const loading = document.getElementById('loading')!;
const label = document.getElementById('label')!;
const bar = document.querySelector<HTMLElement>('#bar > i')!;
const errorBox = document.getElementById('error')!;

// Phones cannot hold the desktop asset set — see MOBILE.md — so the whole set,
// and a few renderer caps with it, are chosen before anything loads.
const { quality, reason } = pickQuality();
const settings = QUALITY[quality];

// three's loaders report a bare "Load failed" on Safari with no clue which file
// it was, which is useless from a phone. Remember the last URL that failed so the
// overlay can name it.
let lastFailedUrl = '';
THREE.DefaultLoadingManager.onError = (url) => { lastFailedUrl = url; };

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

try {
  const kitchen = await loadKitchen(renderer, scene, {
    basePath: `${ASSETS}kitchen/`,
    manifest: settings.manifest,
    maxAnisotropy: settings.maxAnisotropy,
    onProgress: (fraction, what) => {
      bar.style.width = `${Math.round(fraction * 100)}%`;
      label.textContent = fraction >= 1 ? 'Ready' : `Loading ${what}`;
    },
  });

  const { camera, manifest, lightmapped } = kitchen;

  // He faces +z, back to the stove, looking at the camera.
  label.textContent = 'Loading Colin';
  const colin = await loadCharacter(`${ASSETS}character/${settings.characterGlb}`, {
    renderer,
    // Larger than life on purpose: at a measured 1.75 m he reads as a small
    // figure at the back of a wide room. Colin's reference has him with more
    // presence than that.
    height: CHARACTER_HEIGHT,
    envMap: kitchen.envMap,
    // The probe reads about 4x lower than the baked room in practice. The
    // lightmaps recover their true level by multiplying by encodeScale (8); the
    // probe gets no such compensation, so he needs it here or he sits well below
    // the room he is standing in.
    envMapIntensity: 1.1,
    // Colin's own numbers, dialled in on the live panel against the room rather
    // than derived: the diffuse fed back as emission at 0.59, roughness 0.75.
    // Emission is the knob that sets his level — it adds light the tone curve
    // then compresses, so the top of his range flattens and the colour goes with
    // it — and it is paired with his exposure below, which came down to 0.58 at
    // the same time. Panel: Colin — lighting.
    emissiveIntensity: 0.59,
    roughness: 0.75,
  });
  colin.root.position.copy(CHARACTER_SPOT);

  // Colin lives in his own scene, drawn in a second pass over the same depth
  // buffer. That is what lets him have lights at all: the room's light is baked,
  // so a light in the kitchen scene would fall on walls that are already lit.
  // Sharing the depth buffer keeps him correctly occluded by the furniture, and
  // his contact shadow still multiplies against the floor drawn in pass one.
  const characterScene = new THREE.Scene();
  characterScene.environment = kitchen.envMap;   // same probe, so he matches the room
  characterScene.add(colin.root);
  const lights = createCharacterLights();
  characterScene.add(lights.group);

  // The two passes each set exposure, so the room's lives here rather than on the
  // renderer where the character pass would overwrite it.
  const roomExposure = { value: kitchen.manifest.exposure };

  // The experiment: real lights instead of the bake. Off by default — this adds
  // the lights to the room scene and leaves them hidden until the panel says so.
  const roomLights = createRoomLights(renderer, kitchen.room, lightmapped,
    { ...DEFAULT_ROOM_LIGHTS });
  scene.add(roomLights.group);

  if (settings.lensMm !== undefined) kitchen.framing.referenceFov = fovForLens(settings.lensMm);

  /**
   * His face: three meshes off one skeleton, and the layers that move them.
   *
   * The head graft is gone — `colin.glb` is the whole character, so there is no
   * second rig to fit, no head to discard in a shader, and no second set of face
   * textures. `Colin_Head_MIX` on the head mesh is a base shape rather than an
   * expression and has to sit at 1 for his head to be his head; the rig writes
   * it every frame.
   */
  const face = createFaceRig(colin.model);
  const alive = createAlive({ ...DEFAULT_ALIVE });
  console.log(`face — ${face.names.length} shapes across ${face.meshes.length} meshes, `
    + `base shape ${face.ready ? 'found' : 'MISSING'}`);

  // He walks the open strip of floor on his own; the camera drifts after him.
  // No gesture and no permission prompt — the microphone will want one of those
  // soon enough without the camera asking for a second.
  const wander = createWander(colin, { ...DEFAULT_WANDER, area: { ...DEFAULT_WANDER.area } });
  const rig = createCameraRig(camera, {
    mouse: settings.sway === 'mouse',
    config: {
      ...DEFAULT_RIG,
      swayDeg: settings.sway === 'mouse' ? DEFAULT_RIG.swayDeg : 0,
      // Paired with the tier's lens — see quality.ts. Desktop sets neither and
      // keeps the shot exactly as Blender framed it.
      dollyM: settings.dollyM ?? DEFAULT_RIG.dollyM,
    },
  });
  rig.setTarget(colin.root);

  // Talking needs the face, so it only exists if the graft landed. Everything it
  // touches — the microphone, the AudioContext, the network — waits for a tap on
  // the button; nothing here asks for a permission on load.
  // He talks with or without a face: silent lips are a worse conversation, not an
  // impossible one, and there is no reason to take the voice away while the
  // shapes are being sculpted.
  const talk: Conversation = createConversation(
    { endpoint: BRAIN, persona: PERSONA, face, alive, colin, wander, camera },
  );
  if (talk.mouth) {
    console.log(`visemes — ${talk.mouth.rig} rig, ${talk.mouth.matched.length} shapes matched`
      + (talk.mouth.missing.length ? `, missing ${talk.mouth.missing.join(', ')}` : ''));
  }

  const resize = () => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.maxPixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    kitchen.resize(window.innerWidth, window.innerHeight);
  };
  resize();
  window.addEventListener('resize', resize);

  // Because he is a separate pass, he can carry his own tone curve. AgX matches
  // the room to Blender but desaturates hard as values rise, which is what turns
  // his charcoal hoodie grey and caps his skin well below a plain sRGB render of
  // the same model. Defaults to the room's curve; the panel can break them apart.
  // ACES rather than the room's AgX, and this is deliberate. Matched against
  // Colin's Blender render of the same scene, AgX holds his hoodie at the right
  // level but crushes the range above it — skin to hoodie comes out at 1.9 where
  // the reference is 2.7. ACES lands that ratio at 2.71 almost exactly; it just
  // needs a little more exposure than the room to sit at the same level.
  const look = {
    toneMapping: THREE.ACESFilmicToneMapping as THREE.ToneMapping,
    exposure: 0.58,
  };

  const clock = new THREE.Clock();
  renderer.autoClear = false;
  renderer.setAnimationLoop(() => {
    // Clamped: a backgrounded tab resumes with a huge delta, which would
    // teleport him across the room in one frame.
    const dt = Math.min(clock.getDelta(), 0.1);
    wander.update(dt);
    colin.update(dt);
    // After the mixer, which is the only place it can be: the turn clips bake
    // their rotation into the hips, and this moves it onto the root so he keeps
    // it when the clip loops.
    wander.applyRootMotion();
    /* The face, after the mixer so a clip that animates it cannot stomp the
       result, and in one order every frame: clear, then the mouth, then the
       blinks and glances and brows, then write. Everything between the clear and
       the write is asking rather than setting, which is what lets a blink and a
       viseme both have their say about the same face. */
    face.beginFrame();
    talk.update(dt);
    alive.update(dt, face);
    held();
    face.commit();
    rig.update(dt);
    renderer.clear();

    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = roomExposure.value;
    renderer.render(scene, camera);            // baked room, no lights

    renderer.toneMapping = look.toneMapping;
    renderer.toneMappingExposure = look.exposure;
    renderer.render(characterScene, camera);   // Colin, lit by his own rig
  });

  buildTuningPanel(kitchen.manifest.exposure, lightmapped, colin, lights, look, roomExposure, kitchen, resize, wander, rig, face, alive, talk, roomLights);

  // Debug handles. From the devtools console: kitchen.interactive.Fridge_Door,
  // kitchen.lightmapped[0].lightMapIntensity, new THREE.Raycaster(), ...
  Object.assign(window, { renderer, kitchen, colin, wander, rig, face, alive, talk, roomLights, THREE });

  loading.classList.add('done');
  document.body.classList.add('ready');
  // Drop the overlay outright once it has faded. A CSS transition can stall on a
  // busy main thread (software WebGL, slow phones), and a stuck overlay would
  // leave a black sheet over the room.
  const drop = () => loading.remove();
  loading.addEventListener('transitionend', drop, { once: true });
  setTimeout(drop, 1500);
  console.log(
    `quality "${quality}" (${reason}) — ${settings.manifest}, ` +
      `pixelRatio ${renderer.getPixelRatio()}, anisotropy cap ${settings.maxAnisotropy}, ` +
      `lens ${Math.round(lensForFov(kitchen.framing.referenceFov))}mm`,
  );
  console.log(
    `kitchen ready — camera "${camera.name}" (${camera.userData.name ?? '?'}), ` +
      `${lightmapped.length} lightmapped materials, ` +
      `exposure ${manifest.exposure}, lightMapIntensity ${manifest.encodeScale}π`,
  );
  console.log(
    `colin ready — measured ${colin.measuredHeight.toFixed(3)}m, fitted to ${CHARACTER_HEIGHT}m, ` +
      `${colin.clips.length} clips`,
  );
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  label.textContent = 'Could not load the kitchen';
  bar.style.display = 'none';
  errorBox.textContent = lastFailedUrl
    ? `${message}\n\nwhile loading:\n${lastFailedUrl}`
    : message;
  console.error(err, lastFailedUrl);
}

/**
 * The four knobs from the README, live. The bake came out slightly brighter than
 * the Blender Eevee render, so exposure is the one most likely to move.
 */
function buildTuningPanel(
  exposure: number,
  lightmapped: THREE.MeshStandardMaterial[],
  colin: Character,
  lights: CharacterLights,
  look: { toneMapping: THREE.ToneMapping; exposure: number },
  roomExposure: { value: number },
  kitchen: Awaited<ReturnType<typeof loadKitchen>>,
  resize: () => void,
  wander: ReturnType<typeof createWander>,
  rig: ReturnType<typeof createCameraRig>,
  face: FaceRig,
  alive: Alive,
  talk: Conversation,
  roomLights: RoomLights,
) {
  const state = {
    exposure,
    lightMapIntensity: lightmapped[0]?.lightMapIntensity ?? 8 * Math.PI,
    envMapIntensity: lightmapped[0]?.envMapIntensity ?? 0.25,
    environmentIntensity: 1,
    logSettings: () => console.log(JSON.stringify(state, (_key, v) => (typeof v === 'function' ? undefined : v), 2)),
  };

  const gui = new GUI({ title: 'Kitchen' });
  gui.add(state, 'exposure', 0.1, 1.5, 0.01)
    .name('exposure')
    .onChange((v: number) => { roomExposure.value = v; });
  gui.add(state, 'lightMapIntensity', 0, 40, 0.1)
    .name('lightmap (room)')
    .onChange((v: number) => { for (const m of lightmapped) m.lightMapIntensity = v; });
  gui.add(state, 'envMapIntensity', 0, 1.5, 0.01)
    .name('reflections (room)')
    .onChange((v: number) => { for (const m of lightmapped) m.envMapIntensity = v; });
  gui.add(state, 'environmentIntensity', 0, 3, 0.01)
    .name('probe (character)')
    .onChange((v: number) => { scene.environmentIntensity = v; });

  /* Baked light versus real light, switchable. The bake is path-traced GI and
     will almost certainly look better; what it cannot do is change, since it is
     a photograph of one lighting state. Worth being able to see both. */
  const relight = gui.addFolder('Lighting experiment');
  const rl = roomLights.config;
  relight.add(rl, 'enabled').name('real lights (bake off)').onChange(roomLights.apply);
  relight.add(rl, 'ambient', 0, 3, 0.01).name('sky + bounce').onChange(roomLights.apply);
  relight.add(rl, 'sun', 0, 8, 0.05).name('daylight').onChange(roomLights.apply);
  relight.add(rl, 'sunAzimuthDeg', -180, 180, 1).name('daylight from °').onChange(roomLights.apply);
  relight.add(rl, 'sunElevationDeg', 5, 85, 1).name('daylight height °').onChange(roomLights.apply);
  relight.add(rl, 'bulb', 0, 30, 0.1).name('pendant bulb').onChange(roomLights.apply);
  relight.add(rl, 'fill', 0, 2, 0.01).name('fourth wall fill').onChange(roomLights.apply);
  relight.add(rl, 'envMapIntensity', 0, 2, 0.01).name('HDR probe').onChange(roomLights.apply);
  relight.add(rl, 'shadows').name('sun shadows').onChange(roomLights.apply);

  const roam = gui.addFolder('Wandering');
  const w = wander.config;
  roam.add(w, 'enabled').name('walk around').listen();   // the conversation switches this off while he answers
  roam.add(w, 'speed', 0.2, 1.6, 0.01).name('walk speed m/s');
  roam.add(w, 'turnSpeed', 30, 360, 5).name('turn °/s');
  roam.add(w, 'pauseMin', 0, 20, 0.5).name('pause min s');
  roam.add(w, 'pauseMax', 0, 30, 0.5).name('pause max s');
  roam.add(w, 'maxFacingAwayDeg', 30, 180, 5).name('max turn from camera °');
  const area = gui.addFolder('  walkable floor');
  area.add(w.area, 'minX', -3, 1.5, 0.05).name('min x');
  area.add(w.area, 'maxX', -3, 1.5, 0.05).name('max x');
  area.add(w.area, 'minZ', 0, 6, 0.05).name('min z');
  area.add(w.area, 'maxZ', 0, 6, 0.05).name('max z');
  area.close();
  roam.add(rig.config, 'followDeg', 0, 12, 0.1).name('camera follow °');
  roam.add(rig.config, 'followLag', 0.1, 4, 0.05).name('camera lag s');
  roam.add(rig.config, 'swayDeg', 0, 10, 0.1).name('mouse sway °');
  roam.open();

  {
    const fx = gui.addFolder('Face');
    const a = alive.config;
    fx.add(a, 'enabled').name('blinks and glances');
    fx.add(a, 'blinkMin', 0.5, 8, 0.1).name('blink every, min s');
    fx.add(a, 'blinkMax', 1, 20, 0.1).name('blink every, max s');
    fx.add(a, 'gaze', 0, 1, 0.01).name('eye travel');
    fx.add(a, 'brow', 0, 0.6, 0.01).name('brow drift');
    // Hold an expression to look at it. They are written to be subtle, which
    // means the only way to judge one is to see it on its own.
    const demo = { expression: 'neutral' as ExpressionName, shape: face.names[0] ?? '', amount: 0 };
    fx.add(demo, 'expression', ['neutral', 'listening', 'thinking', 'amused', 'doubtful', 'surprised'])
      .name('hold expression')
      .onChange((v: ExpressionName) => alive.express(v, 9999));
    /* Any single shape, held. `want` is cleared every frame by the compositor,
       so a one-shot write would vanish; this re-asks for it each frame instead. */
    fx.add(demo, 'shape', face.names).name('test shape');
    fx.add(demo, 'amount', 0, 1, 0.01).name('amount');
    held = () => { if (demo.amount > 0) face.want(demo.shape, demo.amount); };
    fx.open();
  }

  {
    // Typing at him is the same path a spoken sentence takes — heard, answered,
    // spoken, lip-synced — with the recogniser cut out. It is how any of this
    // gets tested on a machine where talking out loud is awkward, and it needs
    // no microphone permission at all.
    const chat = gui.addFolder('Talking');
    const line = { text: '', send: () => { if (line.text.trim()) talk.say(line.text.trim()); } };
    chat.add(line, 'text').name('say to him');
    chat.add(line, 'send').name('send');
    chat.add(talk.voice, 'volume', 0, 4, 0.05).name('voice volume');
    chat.add({ hush: () => talk.voice.stop() }, 'hush').name('stop talking');
    chat.add({ forget: () => talk.brain.forget() }, 'forget').name('forget the conversation');
  }

  const shot = gui.addFolder('Camera');
  const framing = {
    mode: kitchen.framing.mode as FramingMode,
    lens: Math.round(lensForFov(kitchen.framing.referenceFov)),
    maxFov: kitchen.framing.maxFov,
  };
  shot.add(framing, 'mode', ['lens', 'cover'] as FramingMode[]).name('framing')
    .onChange((v: FramingMode) => { kitchen.framing.mode = v; resize(); });
  // 35mm-equivalent focal length. The bake is 24 mm; longer crops in from the
  // same spot, which is the cheap way to get the near furniture out of frame.
  shot.add(framing, 'lens', 14, 105, 1).name('lens (mm)')
    .onChange((v: number) => { kitchen.framing.referenceFov = fovForLens(v); resize(); });
  // Only bites in `cover` mode, where a tall viewport would otherwise open the
  // lens to 117 degrees vertical — a 7 mm fisheye.
  shot.add(framing, 'maxFov', 40, 120, 1).name('max vertical FOV °')
    .onChange((v: number) => { kitchen.framing.maxFov = v; resize(); });
  /* The other half of the lens. Longer glass crops in and takes the room with
     it; backing the camera off puts the room back and keeps the compression,
     which is the difference between a portrait lens and a zoom. Roughly, to
     hold him the same size on screen: dolly = 3.2 × (newLens / 16 − 1). So
     35 mm wants about 3.8 m, 50 mm about 6.8 m. */
  shot.add(rig.config, 'dollyM', 0, 10, 0.1).name('camera back (m)');

  shot.open();
  gui.add(state, 'logSettings').name('log settings to console');

  const skin = colin.materials;
  const him = gui.addFolder('Colin');
  const pose = {
    clip: colin.clips.find((c) => c.startsWith('idle')) ?? colin.clips[0],
    turn: 0,
    height: CHARACTER_HEIGHT,
    shadow: 1,
  };
  him.add(pose, 'clip', colin.clips).name('animation').onChange((v: string) => colin.play(v));
  him.add(pose, 'turn', -180, 180, 1).name('facing °')
    .onChange((v: number) => { colin.root.rotation.y = THREE.MathUtils.degToRad(v); });
  him.add(pose, 'height', 1.4, 3, 0.01).name('height (m)')
    .onChange((v: number) => colin.setHeight(v));
  him.add(pose, 'shadow', 0, 1, 0.01).name('contact shadow')
    .onChange((v: number) => colin.setShadowStrength(v));

  const lit = gui.addFolder('Colin — lighting');
  const light = {
    probe: skin[0]?.envMapIntensity ?? 1,
    key: lights.key.intensity,
    fill: lights.fill.intensity,
    rim: lights.rim.intensity,
    // His hoodie and jeans are near-black in the texture (mean albedo 0.0065).
    // Diffuse light cannot lift that, so these two are the real handles:
    // roughness decides how much of a specular edge he catches, and lift
    // multiplies the base colour itself.
    roughness: skin[0]?.roughness ?? 0.9,
    emissive: skin[0]?.emissiveIntensity ?? 0,
    lift: 1,
  };
  lit.add(light, 'probe', 0, 10, 0.05).name('HDR probe')
    .onChange((v: number) => { for (const m of skin) m.envMapIntensity = v; });
  lit.add(light, 'key', 0, 8, 0.05).name('key (window)')
    .onChange((v: number) => { lights.key.intensity = v; });
  lit.add(light, 'fill', 0, 8, 0.05).name('fill (doorway)')
    .onChange((v: number) => { lights.fill.intensity = v; });
  lit.add(light, 'rim', 0, 12, 0.05).name('rim (behind)')
    .onChange((v: number) => { lights.rim.intensity = v; });
  lit.add(light, 'roughness', 0, 1, 0.01).name('roughness')
    .onChange((v: number) => { for (const m of skin) m.roughness = v; });
  lit.add(light, 'emissive', 0, 1.5, 0.01).name('self-illumination')
    .onChange((v: number) => { for (const m of skin) m.emissiveIntensity = v; });
  lit.add(light, 'lift', 1, 6, 0.05).name('albedo lift')
    .onChange((v: number) => { for (const m of skin) m.color.setScalar(v); });

  // His own tone curve, which only works because he is a separate pass. AgX keeps
  // him consistent with the room; Neutral and ACES hold far more saturation, and
  // None is the raw sRGB look a standalone viewer shows.
  const curves: Record<string, THREE.ToneMapping> = {
    'AgX (matches room)': THREE.AgXToneMapping,
    Neutral: THREE.NeutralToneMapping,
    ACESFilmic: THREE.ACESFilmicToneMapping,
    Reinhard: THREE.ReinhardToneMapping,
    None: THREE.NoToneMapping,
  };
  const curveState = { curve: 'ACESFilmic', exposure: look.exposure };
  lit.add(curveState, 'curve', Object.keys(curves)).name('tone curve')
    .onChange((v: string) => { look.toneMapping = curves[v]; });
  lit.add(curveState, 'exposure', 0.1, 2, 0.01).name('his exposure')
    .onChange((v: number) => { look.exposure = v; });
  lit.open();
  gui.close();
}
