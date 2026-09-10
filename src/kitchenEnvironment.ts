// kitchenEnvironment.ts — loads the baked kitchen into a three.js scene.
//
// Assets live side by side in public/kitchen/:
//   kitchen_room.glb, kitchen_lightmaps.json, kitchen_probe.hdr, lightmaps/*.webp
// The GLB is Draco-compressed. Since r180 DRACOLoader resolves its own decoder
// through import.meta.url, so the bundler emits it and no copy into public/ is
// needed — pass `dracoPath` only to override that (e.g. a CDN copy).
//
// How the lighting works — read before touching materials or adding lights:
//   * The room's light is baked. Each lightmapped mesh carries a second UV set
//     (TEXCOORD_1) and an atlas tag in its glTF extras (userData.lightmap_atlas),
//     with the manifest's mesh map as a fallback.
//   * Lightmaps store light/8 in sRGB so window sunlight survives 8 bits, hence
//     lightMapIntensity = 8 * PI. The PI undoes three.js dividing lightmap
//     irradiance by PI in the Lambert term.
//   * Metals, glass and emissive bits get no lightmap — the HDR probe lights them.
//   * There are deliberately no real-time lights: one would hit the already-baked
//     walls and roughly double their brightness.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
// three < r180: use RGBELoader from 'three/addons/loaders/RGBELoader.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export interface KitchenManifest {
  /** Lightmaps store light / encodeScale so they fit in 8-bit sRGB. */
  encodeScale: number;
  colorSpace: string;
  /** UV set the lightmaps are addressed by (1 = TEXCOORD_1). */
  uvChannel: number;
  atlases: Record<string, string>;
  /** Mesh/material name -> atlas key. Fallback for meshes without extras. */
  meshes: Record<string, string>;
  interactive: string[];
  /**
   * Camera_Wide's transform, in case a re-export drops the cameras (the Blender
   * glTF exporter has a "Cameras" checkbox that is easy to leave off). The GLB's
   * own camera always wins; this only keeps the site from going dark.
   */
  cameraFallback?: { position: [number, number, number]; fov: number; aspect: number; near: number; far: number };
  probe: string;
  glb: string;
  camera: string;
  exposure: number;
}

export interface Kitchen {
  room: THREE.Group;
  camera: THREE.PerspectiveCamera;
  /** Objects meant to move later: chairs, fridge door, pot, mug... */
  interactive: Record<string, THREE.Object3D | undefined>;
  envMap: THREE.Texture;
  manifest: KitchenManifest;
  /** Every cloned material that got a lightmap, for live tuning. */
  lightmapped: THREE.MeshStandardMaterial[];
  lightmaps: Record<string, THREE.Texture>;
  /** Framing controls; mutate and call `resize` to apply. */
  framing: Framing;
  /** Point the camera at a viewport, preserving the reference framing. */
  resize: (width: number, height: number) => void;
}

export type FramingMode = 'lens' | 'cover';

export interface Framing {
  /**
   * `lens` keeps the chosen focal length whatever the viewport is, cropping the
   * sides on a tall screen. `cover` instead holds the Blender shot's horizontal
   * framing by opening the lens up — faithful to the reference on a wide window,
   * but on a phone in portrait it reaches for a 7 mm fisheye.
   */
  mode: FramingMode;
  /** Aspect the shot was framed at in Blender (3:2). */
  referenceAspect: number;
  /** Vertical FOV of the reference shot. Set via `fovForLens` to change lens. */
  referenceFov: number;
  /** Ceiling on vertical FOV. Only bites in `cover` mode. */
  maxFov: number;
}

/** Vertical FOV in degrees for a 35mm-equivalent focal length. The bake is 24 mm. */
export function fovForLens(mm: number): number {
  return THREE.MathUtils.radToDeg(2 * Math.atan(12 / mm));
}

/** Inverse of `fovForLens`. */
export function lensForFov(fovDeg: number): number {
  return 12 / Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
}

export interface LoadKitchenOptions {
  basePath?: string;
  /** Which manifest to read; picks the whole asset set with it. */
  manifest?: string;
  /** Cap on anisotropic filtering for the lightmaps. */
  maxAnisotropy?: number;
  /** Override three's bundled Draco decoder, e.g. '/draco/' or a CDN. */
  dracoPath?: string;
  /** Fraction 0..1, called as the pieces land. */
  onProgress?: (fraction: number, label: string) => void;
}

/** Materials that can carry a lightmap (standard/physical, not basic or shader). */
function isLightmappable(m: THREE.Material): m is THREE.MeshStandardMaterial {
  return (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true;
}

export async function loadKitchen(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  // Default follows the deployed base ('/' in dev, '/<repo>/' on Pages) rather
  // than a bare '/', which would 404 under a subpath.
  {
    basePath = `${import.meta.env.BASE_URL}kitchen/`,
    manifest: manifestFile = 'kitchen_lightmaps.json',
    maxAnisotropy: anisotropyCap = Infinity,
    dracoPath,
    onProgress,
  }: LoadKitchenOptions = {},
): Promise<Kitchen> {
  const step = (fraction: number, label: string) => onProgress?.(fraction, label);

  step(0, 'manifest');
  const res = await fetch(basePath + manifestFile);
  if (!res.ok) throw new Error(`Could not fetch ${basePath}${manifestFile} (${res.status})`);
  const manifest: KitchenManifest = await res.json();

  // ?glb=<file> loads a different export from the same folder, for comparing a
  // re-export against the one the manifest names without rebuilding.
  const glbOverride = new URLSearchParams(location.search).get('glb');
  if (glbOverride && /^[\w.-]+\.glb$/.test(glbOverride)) manifest.glb = glbOverride;

  // Colour pipeline close to Blender's AgX view at exposure -0.85
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = manifest.exposure; // ~0.55; nudge to taste

  step(0.05, 'lightmaps');
  const texLoader = new THREE.TextureLoader();
  const maxAnisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), anisotropyCap);
  const lightmaps: Record<string, THREE.Texture> = {};
  await Promise.all(
    Object.entries(manifest.atlases).map(async ([key, file]) => {
      const t = await texLoader.loadAsync(basePath + file);
      t.flipY = false;                    // glTF UV convention
      t.colorSpace = THREE.SRGBColorSpace;
      t.channel = manifest.uvChannel;     // second UV set (TEXCOORD_1)
      t.anisotropy = maxAnisotropy;
      t.needsUpdate = true;
      lightmaps[key] = t;
    }),
  );
  const LM_INTENSITY = manifest.encodeScale * Math.PI;

  // HDR panorama shot from the middle of the room: lights the character, metals and glass
  step(0.35, 'HDR probe');
  const pmrem = new THREE.PMREMGenerator(renderer);
  const hdr = await new HDRLoader().loadAsync(basePath + manifest.probe);
  const envMap = pmrem.fromEquirectangular(hdr).texture;
  hdr.dispose();
  pmrem.dispose();
  scene.environment = envMap;

  step(0.6, 'room');
  const draco = new DRACOLoader();
  if (dracoPath) draco.setDecoderPath(dracoPath);
  const gltfLoader = new GLTFLoader().setDRACOLoader(draco);
  const gltf = await gltfLoader.loadAsync(basePath + manifest.glb);
  draco.dispose();
  const room = gltf.scene;

  step(0.9, 'materials');
  const lightmapped: THREE.MeshStandardMaterial[] = [];
  room.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;

    // Multi-material meshes arrive as a Group of Meshes; the atlas tag sits on the parent node.
    let atlas: string | undefined;
    for (let n: THREE.Object3D | null = mesh; n && !atlas; n = n.parent) {
      atlas = n.userData?.lightmap_atlas ?? manifest.meshes[n.name];
    }

    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const out = list.map((m) => {
      if (m.transparent) m.depthWrite = false;      // cabinet / window glass
      if (!atlas || !isLightmappable(m)) return m;  // metals, glass, glowing bits: env map only
      const c = m.clone();                          // one material can span meshes in different atlases
      c.lightMap = lightmaps[atlas] ?? null;
      c.lightMapIntensity = LM_INTENSITY;
      // envMap has to be assigned explicitly for envMapIntensity to mean
      // anything. When a material leaves it null and the scene has an
      // environment, three overwrites the material's envMapIntensity uniform
      // with scene.environmentIntensity — so this 0.25 was silently running at
      // 1, and these surfaces were double-lit exactly as the notes warn against.
      c.envMap = envMap;
      c.envMapIntensity = 0.25;                     // keep reflections, avoid double-lighting the room
      lightmapped.push(c);
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? out : out[0];
  });
  scene.add(room);

  // Handy references for later interactions (sit, open fridge, lift lid...)
  const interactive = Object.fromEntries(
    manifest.interactive.map((n) => [n, room.getObjectByName(n)]),
  );

  // The camera from the wide reference shot.
  // In the GLB the camera nodes (Camera_Wide, Camera_Closeup) are scene roots and
  // three names the resulting object after the glTF *camera* (Cam_Wide), keeping the
  // node name in userData — so match on any of the names the node could surface under.
  let camera = findCamera(room, manifest.camera);
  if (!camera) {
    const fb = manifest.cameraFallback;
    if (!fb) {
      throw new Error(
        `No camera matching "${manifest.camera}" in ${manifest.glb}. ` +
          `Cameras found: ${listCameras(room).join(', ') || 'none'}`,
      );
    }
    console.warn(
      `${manifest.glb} has no camera "${manifest.camera}" (found: ` +
        `${listCameras(room).join(', ') || 'none'}). Falling back to the transform in ` +
        `kitchen_lightmaps.json. Re-export from Blender with Include > Cameras ticked ` +
        `so the framing comes from the scene rather than a copy of it.`,
    );
    camera = new THREE.PerspectiveCamera(fb.fov, fb.aspect, fb.near, fb.far);
    camera.position.fromArray(fb.position);
    room.add(camera);
  }

  // three sets these from the glTF camera, so they still hold the Blender framing.
  // `lens` by default. On a window at or wider than 3:2 the two modes are
  // identical, so this only changes what a tall viewport does — and there,
  // holding the lens is the difference between a portrait shot and a fisheye.
  const framing: Framing = {
    mode: 'lens',
    referenceAspect: camera.aspect,
    referenceFov: camera.fov,
    maxFov: 65,
  };
  const resize = (width: number, height: number) => fitCameraToViewport(camera, framing, width, height);
  resize(renderer.domElement.clientWidth || 1, renderer.domElement.clientHeight || 1);

  step(1, 'ready');
  return {
    room, camera, interactive, envMap, manifest,
    lightmapped, lightmaps, framing, resize,
  };
}

/**
 * Frame the viewport without losing the reference shot.
 *
 * Widening past 3:2 just reveals more room to the sides, which is fine. Going
 * narrower (a phone in portrait) would crop the stove wall out of frame, so
 * widen the vertical FOV instead to hold the horizontal framing steady.
 */
export function fitCameraToViewport(
  camera: THREE.PerspectiveCamera,
  framing: Framing,
  width: number,
  height: number,
) {
  const aspect = width / height;
  camera.aspect = aspect;
  const halfV = THREE.MathUtils.degToRad(framing.referenceFov) / 2;
  const widened =
    framing.mode === 'cover' && aspect < framing.referenceAspect
      ? THREE.MathUtils.radToDeg(2 * Math.atan((Math.tan(halfV) * framing.referenceAspect) / aspect))
      : framing.referenceFov;
  camera.fov = Math.min(widened, framing.maxFov);
  camera.updateProjectionMatrix();
}

/** All camera-ish names a glTF node can surface under in three. */
function cameraNames(o: THREE.Object3D): string[] {
  return [o.name, o.userData?.name, o.parent?.name, o.parent?.userData?.name].filter(
    (n): n is string => typeof n === 'string' && n.length > 0,
  );
}

function findCamera(root: THREE.Object3D, wanted: string): THREE.PerspectiveCamera | null {
  let found: THREE.PerspectiveCamera | null = null;
  root.traverse((o) => {
    if (found) return;
    const cam = o as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera && cameraNames(o).includes(wanted)) found = cam;
  });
  return found;
}

function listCameras(root: THREE.Object3D): string[] {
  const names: string[] = [];
  root.traverse((o) => {
    if ((o as THREE.Camera).isCamera) names.push(cameraNames(o).join('/'));
  });
  return names;
}

export interface SwayConfig {
  /** Peak yaw in degrees; pitch is half this. Mutate to tune live. */
  maxDeg: number;
}

/** Tiny "breathing" camera sway that follows the mouse (a few degrees at most). */
export function addCameraSway(
  camera: THREE.Camera,
  dom: Window | HTMLElement = window,
  config: SwayConfig = { maxDeg: 2.5 },
) {
  const base = camera.quaternion.clone();
  const target = new THREE.Vector2();
  const cur = new THREE.Vector2();

  dom.addEventListener('pointermove', ((e: PointerEvent) => {
    target.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      (e.clientY / window.innerHeight) * 2 - 1,
    );
  }) as EventListener);

  const euler = new THREE.Euler();
  const q = new THREE.Quaternion();

  return function update() {          // call once per frame
    const k = THREE.MathUtils.degToRad(config.maxDeg);
    cur.lerp(target, 0.05);
    euler.set(-cur.y * k * 0.5, -cur.x * k, 0, 'YXZ');
    camera.quaternion.copy(base).multiply(q.setFromEuler(euler));
  };
}
