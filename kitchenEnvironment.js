// kitchenEnvironment.js — loads the baked kitchen into a three.js scene.
// Put these next to each other in your public folder (e.g. /public/kitchen/):
//   kitchen_room.glb, kitchen_lightmaps.json, kitchen_probe.hdr, lightmaps/*.png
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'; // three < r180: use RGBELoader from 'three/addons/loaders/RGBELoader.js'

export async function loadKitchen(renderer, scene, { basePath = '/kitchen/' } = {}) {
  const manifest = await (await fetch(basePath + 'kitchen_lightmaps.json')).json();

  // Colour pipeline close to Blender's AgX + exposure -0.85
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = manifest.exposure; // ~0.55; nudge to taste

  // Lightmaps: stored as sRGB PNG at 1/8 of the real light value -> decode with intensity 8 * PI
  const texLoader = new THREE.TextureLoader();
  const lightmaps = {};
  await Promise.all(Object.entries(manifest.atlases).map(async ([key, file]) => {
    const t = await texLoader.loadAsync(basePath + file);
    t.flipY = false;                       // glTF UV convention
    t.colorSpace = THREE.SRGBColorSpace;
    t.channel = manifest.uvChannel;        // second UV set (TEXCOORD_1)
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    lightmaps[key] = t;
  }));
  const LM_INTENSITY = manifest.encodeScale * Math.PI;

  // HDR panorama rendered from the middle of the room: lights the character, metals and glass
  const pmrem = new THREE.PMREMGenerator(renderer);
  const hdr = await new HDRLoader().loadAsync(basePath + manifest.probe);
  const envMap = pmrem.fromEquirectangular(hdr).texture;
  hdr.dispose(); pmrem.dispose();
  scene.environment = envMap;

  const gltf = await new GLTFLoader().loadAsync(basePath + manifest.glb);
  const room = gltf.scene;

  room.traverse((obj) => {
    if (!obj.isMesh) return;
    // Multi-material meshes arrive as a Group of Meshes; the atlas tag sits on the parent node.
    let atlas = null;
    for (let n = obj; n && !atlas; n = n.parent) atlas = n.userData?.lightmap_atlas || manifest.meshes[n.name];
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    const out = list.map((m) => {
      if (m.transparent) m.depthWrite = false;          // cabinet / window glass
      if (!atlas) return m;                              // metals, glass, glowing bits: env map only
      const c = m.clone();                               // one material can live on meshes in different atlases
      c.lightMap = lightmaps[atlas];
      c.lightMapIntensity = LM_INTENSITY;
      c.envMapIntensity = 0.25;                          // keep reflections, avoid double-lighting the room
      return c;
    });
    obj.material = Array.isArray(obj.material) ? out : out[0];
  });
  scene.add(room);

  // Handy references for later interactions (sit, open fridge, lift lid...)
  const interactive = Object.fromEntries(manifest.interactive.map((n) => [n, room.getObjectByName(n)]));

  // The camera from the wide reference shot
  let camera = null;
  room.traverse((o) => { if (o.isCamera && o.parent?.name === manifest.camera) camera = o; });
  if (!camera) camera = gltf.cameras[0];

  return { room, camera, interactive, envMap };
}

// Optional: tiny "breathing" camera sway that follows the mouse (a few degrees at most)
export function addCameraSway(camera, dom = window, maxDeg = 2.5) {
  const base = camera.quaternion.clone();
  const target = new THREE.Vector2(); const cur = new THREE.Vector2();
  dom.addEventListener('pointermove', (e) => {
    target.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
  });
  const e = new THREE.Euler(); const q = new THREE.Quaternion(); const k = THREE.MathUtils.degToRad(maxDeg);
  return function update() {                          // call once per frame
    cur.lerp(target, 0.05);
    e.set(-cur.y * k * 0.5, -cur.x * k, 0, 'YXZ');
    camera.quaternion.copy(base).multiply(q.setFromEuler(e));
  };
}
