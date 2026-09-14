// Loads Colin's rigged character into the kitchen.
//
// `colin.glb` is all of him — body, outfit, headphones, head, eyes and teeth on
// one skeleton, textures embedded, with the face's morph targets along for the
// ride. It replaced a body GLB plus a separately grafted head, which is why
// there is no head-fitting machinery here any more; see src/face.ts.
//
// He is drawn in his own scene, in a second pass, so he can have lights at all:
// the room's light is baked, so a light in the kitchen scene would fall on walls
// that are already lit. That also means his shadow is a blob below him rather
// than a real one.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

export interface Character {
  /** Move and turn this; the model inside is scaled and floor-aligned. */
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  clips: string[];
  /** Cross-fade to a clip by name. Unknown names are ignored. */
  play: (name: string, fadeSeconds?: number) => void;
  /**
   * Play a clip faster or slower than authored. This is how a walk cycle gets
   * tied to the speed the body is actually travelling: the clips are in-place,
   * so nothing else connects the stride to the ground.
   */
  setTimeScale: (name: string, scale: number) => void;
  /**
   * How much a clip is contributing right now, 0–1. During a cross-fade the
   * outgoing clip is still posing the skeleton in proportion to this, which is
   * what anything correcting for a clip has to track.
   *
   * Only meaningful for a clip that has been played: three leaves an untouched
   * action's weight at 1, so this cannot be used to ask "is that one playing".
   */
  weightOf: (name: string) => number;
  update: (deltaSeconds: number) => void;
  /** Which clip was last played. */
  readonly playing: string | null;
  /** How far into a clip its action currently is, in seconds, and how long the
   *  clip runs. This is what lets a pose be a place in an animation rather than
   *  a separate asset — freeze the clock and the pose is whatever frame it
   *  stopped on. */
  timeOf: (name: string) => { time: number; duration: number } | null;
  /** Jump a clip's clock. Pairs with `setTimeScale(name, 0)` to hold a frame. */
  seek: (name: string, seconds: number) => void;
  /** What he actually measured before being fitted, in metres. */
  measuredHeight: number;
  /** Re-fit him to a new height, keeping his feet on the floor. */
  setHeight: (metres: number) => void;
  /** 0 = no contact shadow, 1 = full. */
  setShadowStrength: (strength: number) => void;
  /** His standard materials, for tuning brightness and roughness. */
  materials: THREE.MeshStandardMaterial[];
}

export interface LoadCharacterOptions {
  /** Fitted height in metres, feet on the floor. */
  height?: number;
  /**
   * Replace the base colour map on every material that has one.
   *
   * Unused now — `colin.glb` carries its own — and kept because it is the fix
   * for an export that ships a dark one. The body GLB before it was near-black
   * on the hoodie and jeans (mean albedo 0.0065 across the atlas), which made
   * him read as a silhouette in a bright room; pointing this at a repainted
   * atlas swapped it without touching the GLB.
   */
  baseColorMap?: string;
  /**
   * Feed the base colour map back in as emission at this strength (0 = off).
   *
   * Colin's Blender setup for this room uses the diffuse texture as an emission
   * map at 50%. It is not physical, but it is the thing that survives AgX: the
   * curve compresses and desaturates lit values as they rise, whereas emission
   * lands on top of the shading and keeps the hoodie's charcoal and the denim's
   * blue instead of drifting grey.
   */
  emissiveIntensity?: number;
  /** Overrides the roughness the GLB ships. Colin's Blender look uses 0.8. */
  roughness?: number;
  /**
   * Render him as a solid object. See the note where this is applied — the GLB
   * declares alphaMode BLEND, which costs him his depth buffer. Set false only
   * if a future atlas genuinely carries cutout alpha.
   */
  opaque?: boolean;
  /**
   * Needed only to transcode a KTX2 skin — `detectSupport` has to ask the GPU
   * which compressed formats it can take.
   */
  renderer?: THREE.WebGLRenderer;
  /**
   * The room's HDR probe. Assigning it per-material is what makes
   * `envMapIntensity` below take effect: three overwrites that uniform with
   * `scene.environmentIntensity` for any material whose own envMap is null.
   */
  envMap?: THREE.Texture;
  /** Lit by the probe like everything unbaked; the room uses 0.25. */
  envMapIntensity?: number;
  /** Clip to start on. Falls back to the first idle, then the first clip. */
  idle?: string;
  dracoPath?: string;
}

export async function loadCharacter(
  url: string,
  {
    height = 1.75, envMap, envMapIntensity = 1, idle = 'idle_neutral_00',
    baseColorMap, emissiveIntensity = 0, roughness, opaque = true,
    renderer, dracoPath,
  }: LoadCharacterOptions = {},
): Promise<Character> {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  if (dracoPath) draco.setDecoderPath(dracoPath);
  loader.setDRACOLoader(draco);
  // The mobile build ships his skin as KTX2, which stays compressed on the GPU:
  // 2.8 MB against 21.3 MB for the same 2K atlas as RGBA8.
  const ktx2 = renderer ? new KTX2Loader().detectSupport(renderer) : null;
  if (ktx2) loader.setKTX2Loader(ktx2);
  const gltf = await loader.loadAsync(url);
  draco.dispose();
  ktx2?.dispose();

  const model = gltf.scene;
  model.updateMatrixWorld(true);

  // The rig arrives in centimetres under a root that is scaled by 0.01 and
  // rotated a quarter turn, and it is skinned, so its own numbers say little
  // about how tall he ends up. Measure the bind pose and fit that instead —
  // which also means a different body file can be dropped in without retuning.
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const measuredHeight = size.y;
  const scale = measuredHeight > 1e-6 ? height / measuredHeight : 1;
  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);

  // Stand him on the floor and centre him over the origin, so `root.position`
  // means the spot on the ground he occupies.
  const fitted = new THREE.Box3().setFromObject(model);
  const centre = fitted.getCenter(new THREE.Vector3());
  model.position.x -= centre.x;
  model.position.z -= centre.z;
  model.position.y -= fitted.min.y;

  const materials: THREE.MeshStandardMaterial[] = [];
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // Skinned bounds are computed for the bind pose, so an animated limb can
    // leave the box and get culled mid-frame.
    mesh.frustumCulled = false;
    for (const m of [].concat(mesh.material as never) as THREE.Material[]) {
      const std = m as THREE.MeshStandardMaterial;
      if (!std.isMeshStandardMaterial) continue;
      if (envMap) std.envMap = envMap;
      std.envMapIntensity = envMapIntensity;
      if (roughness !== undefined) std.roughness = roughness;

      // His material declares alphaMode BLEND, and three's GLTFLoader turns that
      // into transparent = true AND depthWrite = false. Losing depth writes is
      // what mangles his head: with nothing in the depth buffer, his triangles
      // land in index order, so the back of his skull and the inside of his
      // mouth draw over his face and the hair tears into shards.
      //
      // The blending buys nothing — his atlas has no alpha channel and the
      // material is fully opaque — so it is pure cost. It is a leftover from the
      // Orb setup, where this head was faded out to graft a blendshape head on
      // in its place. We are not grafting, so he goes back to being solid.
      if (opaque && std.transparent && std.opacity >= 1) {
        std.transparent = false;
        std.depthWrite = true;
        std.needsUpdate = true;
      }

      materials.push(std);
    }
  });

  if (baseColorMap) await applyBaseColorMap(materials, baseColorMap);
  if (emissiveIntensity > 0) applyEmissiveFromBaseColor(materials, emissiveIntensity);

  // Re-fit rather than scaling `root`, so the contact shadow keeps its own size
  // and the model stays centred on the spot he occupies.
  const fitTo = (metres: number) => {
    model.scale.setScalar(1);
    model.position.set(0, 0, 0);
    model.updateMatrixWorld(true);
    const raw = new THREE.Box3().setFromObject(model);
    const rawHeight = raw.getSize(new THREE.Vector3()).y;
    model.scale.multiplyScalar(rawHeight > 1e-6 ? metres / rawHeight : 1);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const mid = box.getCenter(new THREE.Vector3());
    model.position.x -= mid.x;
    model.position.z -= mid.z;
    model.position.y -= box.min.y;
  };

  const root = new THREE.Group();
  root.name = 'Character';
  root.add(model);
  const shadow = makeContactShadow(height);
  root.add(shadow.mesh);

  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip));

  let current: THREE.AnimationAction | null = null;
  const play = (name: string, fadeSeconds = 0.4) => {
    const next = actions.get(name);
    if (!next || next === current) return;
    next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(fadeSeconds).play();
    current?.fadeOut(fadeSeconds);
    current = next;
  };

  const weightOf = (name: string) => {
    const action = actions.get(name);
    /* Deliberately NOT `isRunning()`, which is false for an action whose
       timeScale is zero — and freezing a clip's clock while it fades out is
       exactly when its weight matters most. `enabled` still goes false when the
       mixer retires it, which is the thing worth checking. */
    return action && action.enabled ? action.getEffectiveWeight() : 0;
  };

  const setTimeScale = (name: string, scale: number) => {
    const action = actions.get(name);
    if (action) action.timeScale = scale;
  };

  const timeOf = (name: string) => {
    const action = actions.get(name);
    return action ? { time: action.time, duration: action.getClip().duration } : null;
  };

  const seek = (name: string, seconds: number) => {
    const action = actions.get(name);
    if (!action) return;
    action.time = THREE.MathUtils.clamp(seconds, 0, action.getClip().duration);
    /* The mixer only writes the skeleton when it ticks, so a seek on a frozen
       clip shows nothing until something moves. A zero-length update is enough
       to make it take. */
    mixer.update(0);
  };

  const clips = gltf.animations.map((c) => c.name);
  const first = clips.find((n) => n === idle) ?? clips.find((n) => n.startsWith('idle')) ?? clips[0];
  if (first) play(first, 0);

  return {
    root, model, mixer, clips, play, setTimeScale, weightOf, measuredHeight, materials,
    timeOf, seek,
    get playing() { return current ? current.getClip().name : null; },
    setShadowStrength: shadow.setStrength,
    setHeight: fitTo,
    update: (dt) => mixer.update(dt),
  };
}

/**
 * Swap in a base colour map loaded from outside the GLB.
 *
 * glTF textures are addressed with the origin at the top left, so `flipY` has to
 * be false — TextureLoader defaults it to true, and getting this wrong turns his
 * face upside down on the UV island rather than failing loudly. Wrapping and
 * anisotropy are carried over from the map being replaced.
 */
async function applyBaseColorMap(materials: THREE.MeshStandardMaterial[], url: string) {
  const texture = await new THREE.TextureLoader().loadAsync(url);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  let applied = 0;
  for (const m of materials) {
    if (!m.map) continue;                       // leave materials that never had one
    texture.wrapS = m.map.wrapS;
    texture.wrapT = m.map.wrapT;
    texture.anisotropy = m.map.anisotropy;
    m.map.dispose();
    m.map = texture;
    m.needsUpdate = true;
    applied++;
  }
  console.log(`character skin: ${url.split('/').pop()} applied to ${applied} material(s)`);
}

/**
 * Use each material's own base colour map as its emission map.
 *
 * Set after any base colour override, so a swapped-in atlas glows as itself
 * rather than as the one it replaced.
 */
function applyEmissiveFromBaseColor(materials: THREE.MeshStandardMaterial[], intensity: number) {
  for (const m of materials) {
    if (!m.map) continue;
    m.emissiveMap = m.map;
    m.emissive.setScalar(1);          // white, so the map supplies all the colour
    m.emissiveIntensity = intensity;
    m.needsUpdate = true;
  }
}

export interface CharacterLights {
  group: THREE.Group;
  key: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
}

/**
 * A small rig that lights only Colin.
 *
 * These lights CANNOT live in the kitchen scene. The room's light is baked into
 * its lightmaps, so a light there would fall on walls that are already lit and
 * roughly double their brightness. three offers no way to aim a light at one
 * object either — it filters lights by the *camera's* layers, not per object —
 * so the isolation comes from rendering him in a second pass instead.
 *
 * Directions follow the room so he sits in it: key from the window wall at -x,
 * a cool bounce from the doorway at +x, and a rim from behind to lift his
 * silhouette off the stove. The rim matters most: his hoodie is near-black
 * (albedo ~0.01), and no amount of diffuse light brightens that. What makes
 * black cloth read is the specular edge.
 */
export function createCharacterLights(): CharacterLights {
  const group = new THREE.Group();
  group.name = 'CharacterLights';

  // Neutral rather than warm: the probe already carries the room's colour, and
  // stacking a warm key on top pushed his skin to a R/B ratio of 2.6 against
  // roughly 1.4 in Colin's reference render.
  // Deliberately gentle. These were strong while they were compensating for a
  // near-black skin; with the lighter atlas and 50% emission carrying him, the
  // same intensities blew him out. They are here for shape now, not for level.
  const key = new THREE.DirectionalLight(0xffffff, 0.3);   // window side
  key.position.set(-3, 2.6, 2.2);

  const fill = new THREE.DirectionalLight(0x8fbcff, 0.6);  // doorway side, cool
  fill.position.set(2.5, 1.6, 1.5);

  const rim = new THREE.DirectionalLight(0xdde9ff, 0.5);   // behind, for the edge
  rim.position.set(0.8, 2.4, -2.0);

  group.add(key, key.target, fill, fill.target, rim, rim.target);
  return { group, key, fill, rim };
}

/**
 * A soft dark ellipse on the floor. With no lights in the scene there is nothing
 * to cast a real shadow, and without something under him he reads as hovering.
 *
 * Multiply blending, so it darkens whatever is baked into the floor rather than
 * laying flat grey over it. That means the texture must be OPAQUE and fade to
 * WHITE, not to transparent: multiply ignores alpha, so a transparent edge would
 * multiply the floor by zero and stamp a black square around him.
 */
function makeContactShadow(height: number) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  // Strength lives in the gradient rather than in opacity or colour: multiply
  // blending has no alpha to fade, and tinting the material can only ever darken.
  const setStrength = (strength: number) => {
    const k = THREE.MathUtils.clamp(strength, 0, 1);
    // Fade each stop toward white as strength drops.
    const stop = (dark: number) => {
      const v = Math.round(255 - (255 - dark) * k);
      return `rgb(${v},${v},${v})`;
    };
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, stop(105));    // darkest under him
    g.addColorStop(0.4, stop(180));
    g.addColorStop(1, 'rgb(255,255,255)');   // white = leaves the floor alone
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    texture.needsUpdate = true;
  };
  setStrength(1);

  const radius = height * 0.34;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({
      map: texture, blending: THREE.MultiplyBlending, depthWrite: false, toneMapped: false,
      // three requires this flag for MultiplyBlending. The texture is opaque, so
      // premultiplying is a no-op here; it just silences the warning.
      premultipliedAlpha: true,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  // Above the rug he stands on, not just above the floor — the rug is a separate
  // mesh a centimetre or so up, and it was hiding the shadow entirely.
  mesh.position.y = 0.02;
  mesh.renderOrder = 1;
  mesh.name = 'ContactShadow';
  return { mesh, setStrength };
}
