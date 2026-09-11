// Renders the baked kitchen from its reference camera, with a small mouse sway.
// The character (from the Orb/glorp project) drops in later — see CHARACTER_SPOT.
import * as THREE from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import {
  loadKitchen, fovForLens, lensForFov, type FramingMode,
} from './kitchenEnvironment';
import { createCameraRig, DEFAULT_RIG } from './cameraRig';
import { createWander, DEFAULT_WANDER } from './wander';
import { graftHead, DEFAULT_HEAD_FIT, type GraftedHead } from './head';
import { loadCharacter, createCharacterLights, type Character, type CharacterLights } from './character';
import { pickQuality, QUALITY } from './quality';
import { createConversation, type Conversation } from './talk';

/** On the rug in front of the stove, where the HDR probe was rendered. */
export const CHARACTER_SPOT = new THREE.Vector3(-0.3, 0, 1.7);

/**
 * The near dining set. Hidden by default: on a phone it filled the lower third
 * of the frame and none of it does anything yet.
 *
 * Their shadows and bounce are baked into the lightmaps and stay on the floor
 * after they go, so this reads as furniture removed from a photo rather than
 * furniture that was never there. Making it permanent means a re-bake;
 * `ENV_Wood_Table` is deliberately not in the list, since despite the name it is
 * back-wall furniture rather than the near table.
 */
const FOREGROUND = ['ENV_Wood_TableTop', 'Chair_Far', 'Chair_Right', 'Chair_NearLeft', 'Mug_Table'];

function setForegroundVisible(room: THREE.Object3D, visible: boolean) {
  for (const name of FOREGROUND) {
    const obj = room.getObjectByName(name);
    if (obj) obj.visible = visible;
  }
}

/**
 * Where the assets live. '/' in dev, '/<repo>/' on GitHub Pages — every asset
 * path has to go through this or it 404s once deployed under a subpath.
 */
const ASSETS = import.meta.env.BASE_URL;

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
    height: 2.1,
    envMap: kitchen.envMap,
    // The probe reads about 4x lower than the baked room in practice. The
    // lightmaps recover their true level by multiplying by encodeScale (8); the
    // probe gets no such compensation, so he needs it here or he sits well below
    // the room he is standing in.
    envMapIntensity: 1,
    // Desktop overrides the GLB's darker skin with the lighter repaint. The
    // mobile GLB has it baked in already, so it overrides nothing.
    baseColorMap: settings.characterSkin && `${ASSETS}character/${settings.characterSkin}`,
    // Colin's Blender setup for this room: the diffuse fed back as 50% emission,
    // roughness 0.8. Backed off from 0.65 — he was reading a shade hot, and
    // emission is the knob that does it: it adds light the tone curve then
    // compresses, so the top of his range flattens and the colour goes with it.
    // Taking it out brings the level down and lets the lit shading carry more of
    // him. Panel: Colin — lighting -> self-illumination.
    emissiveIntensity: 0.52,
    roughness: 0.8,
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

  if (settings.lensMm !== undefined) kitchen.framing.referenceFov = fovForLens(settings.lensMm);
  setForegroundVisible(kitchen.room, false);

  /**
   * The grafted face — OFF while the visemes are being sculpted onto the
   * full-body mesh itself.
   *
   * It was always the hacky way round: a second head on a different rig, hung
   * off the head joint, with the body's own head thrown away in the shader. It
   * worked, but it is two meshes where one will do, it costs a second set of
   * face textures, and the grafted head is not the head Colin modelled. Once the
   * body carries its own `viseme_*` shapes none of that is needed — see
   * VISEMES.md for the set, and `src/visemes.ts` already knows how to drive them.
   *
   * Everything below stays wired up, so this is one flag either way. With it
   * off, `cutBodyHead` never runs and his own head is simply left alone.
   */
  const USE_HEAD_GRAFT = false;

  label.textContent = USE_HEAD_GRAFT ? 'Loading his face' : 'Nearly there';
  let head: GraftedHead | null = null;
  try {
    if (!USE_HEAD_GRAFT) throw new Error('head graft disabled');
    head = await graftHead(colin, `${ASSETS}character/${settings.headGlb}`, {
      renderer,
      envMap: kitchen.envMap,
      envMapIntensity: 1,
      emissiveIntensity: 0.65,
      roughness: 0.8,
      fit: { ...DEFAULT_HEAD_FIT },
      // Only where the GLB does not already carry them.
      skins: settings.headSkins && Object.fromEntries(
        Object.entries(settings.headSkins).map(([m, f]) => [m, `${ASSETS}character/${f}`]),
      ),
    });
    console.log(`head grafted — ${Object.keys(head.morphs).length} blendshapes, ` +
      `scale ${head.measuredScale.toFixed(3)}`);
  } catch (err) {
    // Not fatal: without it he is the body's own head and cannot lip-sync.
    if (USE_HEAD_GRAFT) console.warn('head graft failed, keeping the body head:', err);
    else console.log('head graft off — his own head, no visemes yet');
  }

  // He walks the open strip of floor on his own; the camera drifts after him.
  // No gesture and no permission prompt — the microphone will want one of those
  // soon enough without the camera asking for a second.
  const wander = createWander(colin, { ...DEFAULT_WANDER, area: { ...DEFAULT_WANDER.area } });
  const rig = createCameraRig(camera, {
    mouse: settings.sway === 'mouse',
    config: { ...DEFAULT_RIG, swayDeg: settings.sway === 'mouse' ? DEFAULT_RIG.swayDeg : 0 },
  });
  rig.setTarget(colin.root);

  // Talking needs the face, so it only exists if the graft landed. Everything it
  // touches — the microphone, the AudioContext, the network — waits for a tap on
  // the button; nothing here asks for a permission on load.
  // He talks with or without a face: silent lips are a worse conversation, not an
  // impossible one, and there is no reason to take the voice away while the
  // shapes are being sculpted.
  const talk: Conversation = createConversation(
    { endpoint: BRAIN, persona: PERSONA, head, colin, wander, camera },
  );

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
    exposure: 0.75,
  };

  const clock = new THREE.Clock();
  renderer.autoClear = false;
  renderer.setAnimationLoop(() => {
    // Clamped: a backgrounded tab resumes with a huge delta, which would
    // teleport him across the room in one frame.
    const dt = Math.min(clock.getDelta(), 0.1);
    wander.update(dt);
    colin.update(dt);
    // After the mixer: the visemes write morph influences, and a clip that
    // animated the face would otherwise stomp them on the way past.
    talk.update(dt);
    rig.update(dt);
    renderer.clear();

    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = roomExposure.value;
    renderer.render(scene, camera);            // baked room, no lights

    renderer.toneMapping = look.toneMapping;
    renderer.toneMappingExposure = look.exposure;
    renderer.render(characterScene, camera);   // Colin, lit by his own rig
  });

  buildTuningPanel(kitchen.manifest.exposure, lightmapped, colin, lights, look, roomExposure, kitchen, resize, wander, rig, head, talk);

  // Debug handles. From the devtools console: kitchen.interactive.Fridge_Door,
  // kitchen.lightmapped[0].lightMapIntensity, new THREE.Raycaster(), ...
  Object.assign(window, { renderer, kitchen, colin, wander, rig, head, talk, THREE });

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
    `colin ready — measured ${colin.measuredHeight.toFixed(3)}m, fitted to 1.75m, ` +
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
  head: GraftedHead | null,
  talk: Conversation,
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

  if (head) {
    const face = gui.addFolder('Face graft');
    const f = head.fit;
    face.add(f, 'scale', 0.5, 2, 0.005).name('head scale').onChange(head.apply);
    face.add(f, 'offsetY', -0.3, 0.3, 0.002).name('offset up (m)').onChange(head.apply);
    face.add(f, 'offsetZ', -0.3, 0.3, 0.002).name('offset fwd (m)').onChange(head.apply);
    face.add(f, 'pitchDeg', -30, 30, 0.5).name('pitch °').onChange(head.apply);
    face.add(f, 'yawDeg', -30, 30, 0.5).name('yaw °').onChange(head.apply);
    // How much of a vertex has to belong to the head bone before it is thrown
    // away. Too low and the collar goes with it; too high and a skullcap stays.
    face.add(f, 'cut', 0.1, 1, 0.01).name('head cut').onChange((v: number) => {
      colin.model.traverse((o) => {
        for (const m of [].concat((o as THREE.Mesh).material as never) as THREE.Material[]) {
          const u = m?.userData?.headCut as { value: number } | undefined;
          if (u) u.value = v;
        }
      });
    });
    const visemes = Object.keys(head.morphs).filter((n) => n.startsWith('V_'));
    const demo = { viseme: visemes[0] ?? '', amount: 0 };
    if (visemes.length) {
      face.add(demo, 'viseme', visemes).name('test viseme')
        .onChange(() => { head.clearMorphs(); head.setMorph(demo.viseme, demo.amount); });
      face.add(demo, 'amount', 0, 1, 0.01).name('amount')
        .onChange((v: number) => { head.clearMorphs(); head.setMorph(demo.viseme, v); });
    }
    face.open();
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
    hideForeground: true,
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

  shot.add(framing, 'hideForeground').name('hide table & chairs')
    .onChange((v: boolean) => setForegroundVisible(kitchen.room, !v));
  shot.open();
  gui.add(state, 'logSettings').name('log settings to console');

  const skin = colin.materials;
  const him = gui.addFolder('Colin');
  const pose = {
    clip: colin.clips.find((c) => c.startsWith('idle')) ?? colin.clips[0],
    turn: 0,
    height: 2.1,
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
