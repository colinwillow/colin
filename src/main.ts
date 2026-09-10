// Renders the baked kitchen from its reference camera, with a small mouse sway.
// The character (from the Orb/glorp project) drops in later — see CHARACTER_SPOT.
import * as THREE from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import {
  loadKitchen, addCameraSway, fovForLens, lensForFov,
  type SwayConfig, type FramingMode,
} from './kitchenEnvironment';
import { loadCharacter, createCharacterLights, type Character, type CharacterLights } from './character';
import { pickQuality, QUALITY } from './quality';

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

const loading = document.getElementById('loading')!;
const label = document.getElementById('label')!;
const bar = document.querySelector<HTMLElement>('#bar > i')!;
const errorBox = document.getElementById('error')!;

// Phones cannot hold the desktop asset set — see MOBILE.md — so the whole set,
// and a few renderer caps with it, are chosen before anything loads.
const { quality, reason } = pickQuality();
const settings = QUALITY[quality];

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
  const colin = await loadCharacter(`${ASSETS}character/colin_stylized_01.glb`, {
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
    // The GLB embeds a skin, but this lighter repaint replaces it.
    baseColorMap: `${ASSETS}character/Mat_diffuse_lighter.webp`,
    // Colin's Blender setup for this room: the diffuse fed back as 50% emission,
    // roughness 0.8.
    emissiveIntensity: 0.65,
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
  const rig = createCharacterLights();
  characterScene.add(rig.group);

  // The two passes each set exposure, so the room's lives here rather than on the
  // renderer where the character pass would overwrite it.
  const roomExposure = { value: kitchen.manifest.exposure };

  if (settings.lensMm !== undefined) kitchen.framing.referenceFov = fovForLens(settings.lensMm);
  setForegroundVisible(kitchen.room, false);

  // Off on touch: pointermove only fires there while a finger is down, so the
  // camera would jump on tap instead of breathing.
  const sway: SwayConfig = { maxDeg: settings.sway ? 2.5 : 0 };
  const updateSway = settings.sway ? addCameraSway(camera, window, sway) : () => {};

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
    colin.update(clock.getDelta());
    updateSway();
    renderer.clear();

    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = roomExposure.value;
    renderer.render(scene, camera);            // baked room, no lights

    renderer.toneMapping = look.toneMapping;
    renderer.toneMappingExposure = look.exposure;
    renderer.render(characterScene, camera);   // Colin, lit by his own rig
  });

  buildTuningPanel(kitchen.manifest.exposure, lightmapped, sway, colin, rig, look, roomExposure, kitchen, resize);

  // Debug handles. From the devtools console: kitchen.interactive.Fridge_Door,
  // kitchen.lightmapped[0].lightMapIntensity, new THREE.Raycaster(), ...
  Object.assign(window, { kitchen, colin, THREE });

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
  errorBox.textContent = message;
  console.error(err);
}

/**
 * The four knobs from the README, live. The bake came out slightly brighter than
 * the Blender Eevee render, so exposure is the one most likely to move.
 */
function buildTuningPanel(
  exposure: number,
  lightmapped: THREE.MeshStandardMaterial[],
  sway: SwayConfig,
  colin: Character,
  rig: CharacterLights,
  look: { toneMapping: THREE.ToneMapping; exposure: number },
  roomExposure: { value: number },
  kitchen: Awaited<ReturnType<typeof loadKitchen>>,
  resize: () => void,
) {
  const state = {
    exposure,
    lightMapIntensity: lightmapped[0]?.lightMapIntensity ?? 8 * Math.PI,
    envMapIntensity: lightmapped[0]?.envMapIntensity ?? 0.25,
    environmentIntensity: 1,
    swayDegrees: sway.maxDeg,
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
  gui.add(state, 'swayDegrees', 0, 10, 0.1)
    .name('camera sway °')
    .onChange((v: number) => { sway.maxDeg = v; });

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
    key: rig.key.intensity,
    fill: rig.fill.intensity,
    rim: rig.rim.intensity,
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
    .onChange((v: number) => { rig.key.intensity = v; });
  lit.add(light, 'fill', 0, 8, 0.05).name('fill (doorway)')
    .onChange((v: number) => { rig.fill.intensity = v; });
  lit.add(light, 'rim', 0, 12, 0.05).name('rim (behind)')
    .onChange((v: number) => { rig.rim.intensity = v; });
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
