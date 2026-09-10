// Renders the baked kitchen from its reference camera, with a small mouse sway.
// The character (from the Orb/glorp project) drops in later — see CHARACTER_SPOT.
import * as THREE from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { loadKitchen, addCameraSway, type SwayConfig } from './kitchenEnvironment';

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

  const sway: SwayConfig = { maxDeg: 2.5 };
  const updateSway = addCameraSway(camera, window, sway);

  const resize = () => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    kitchen.resize(window.innerWidth, window.innerHeight);
  };
  resize();
  window.addEventListener('resize', resize);

  renderer.setAnimationLoop(() => {
    updateSway();
    renderer.render(scene, camera);
  });

  buildTuningPanel(kitchen.manifest.exposure, lightmapped, sway);

  // Debug handles. From the devtools console: kitchen.interactive.Fridge_Door,
  // kitchen.lightmapped[0].lightMapIntensity, new THREE.Raycaster(), ...
  Object.assign(window, { kitchen, THREE });

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
  gui.close();
}
