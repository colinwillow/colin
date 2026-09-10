// Renders the baked kitchen from its reference camera, with a small mouse sway.
// The character (from the Orb/glorp project) drops in later — see CHARACTER_SPOT.
import * as THREE from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { loadKitchen, addCameraSway, type SwayConfig } from './kitchenEnvironment';
import { loadCharacter, createCharacterLights, type Character, type CharacterLights } from './character';

/** On the rug in front of the stove, where the HDR probe was rendered. */
export const CHARACTER_SPOT = new THREE.Vector3(-0.3, 0, 1.7);

const loading = document.getElementById('loading')!;
const label = document.getElementById('label')!;
const bar = document.querySelector<HTMLElement>('#bar > i')!;
const errorBox = document.getElementById('error')!;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// Cap at 2: the room is texture-heavy and 3x on a phone buys nothing visible.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

try {
  const kitchen = await loadKitchen(renderer, scene, {
    basePath: `${import.meta.env.BASE_URL}kitchen/`,
    onProgress: (fraction, what) => {
      bar.style.width = `${Math.round(fraction * 100)}%`;
      label.textContent = fraction >= 1 ? 'Ready' : `Loading ${what}`;
    },
  });

  const { camera, manifest, lightmapped } = kitchen;

  // He faces +z, back to the stove, looking at the camera.
  label.textContent = 'Loading Colin';
  const colin = await loadCharacter('/character/colin_slim.glb', { height: 1.75 });
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

  const sway: SwayConfig = { maxDeg: 2.5 };
  const updateSway = addCameraSway(camera, window, sway);

  const resize = () => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    kitchen.resize(window.innerWidth, window.innerHeight);
  };
  resize();
  window.addEventListener('resize', resize);

  const clock = new THREE.Clock();
  renderer.autoClear = false;
  renderer.setAnimationLoop(() => {
    colin.update(clock.getDelta());
    updateSway();
    renderer.clear();
    renderer.render(scene, camera);            // baked room, no lights
    renderer.render(characterScene, camera);   // Colin, lit by his own rig
  });

  buildTuningPanel(kitchen.manifest.exposure, lightmapped, sway, colin, rig);

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
    .onChange((v: number) => { renderer.toneMappingExposure = v; });
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
  gui.add(state, 'logSettings').name('log settings to console');

  const skin = colin.materials;
  const him = gui.addFolder('Colin');
  const pose = {
    clip: colin.clips.find((c) => c.startsWith('idle')) ?? colin.clips[0],
    turn: 0,
    shadow: 1,
  };
  him.add(pose, 'clip', colin.clips).name('animation').onChange((v: string) => colin.play(v));
  him.add(pose, 'turn', -180, 180, 1).name('facing °')
    .onChange((v: number) => { colin.root.rotation.y = THREE.MathUtils.degToRad(v); });
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
    lift: 1,
  };
  lit.add(light, 'probe', 0, 4, 0.01).name('HDR probe')
    .onChange((v: number) => { for (const m of skin) m.envMapIntensity = v; });
  lit.add(light, 'key', 0, 8, 0.05).name('key (window)')
    .onChange((v: number) => { rig.key.intensity = v; });
  lit.add(light, 'fill', 0, 8, 0.05).name('fill (doorway)')
    .onChange((v: number) => { rig.fill.intensity = v; });
  lit.add(light, 'rim', 0, 12, 0.05).name('rim (behind)')
    .onChange((v: number) => { rig.rim.intensity = v; });
  lit.add(light, 'roughness', 0, 1, 0.01).name('roughness')
    .onChange((v: number) => { for (const m of skin) m.roughness = v; });
  lit.add(light, 'lift', 1, 6, 0.05).name('albedo lift')
    .onChange((v: number) => { for (const m of skin) m.color.setScalar(v); });
  lit.open();
  gui.close();
}
