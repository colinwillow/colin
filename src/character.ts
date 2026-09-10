// Loads Colin's rigged toon character into the kitchen.
//
// The body is `colin_slim.glb`, brought over from the Orb/glorp project. Of the
// figures there it is the only self-contained one: a single mesh, its texture
// embedded, 82 joints, and 36 animation clips. The other bodies (colin_anim2)
// need their skin supplied from images/textures/ and a separate head grafted on
// at a bone, which is machinery worth porting only when the visemes come over
// with it.
//
// He is lit entirely by the room's HDR probe (scene.environment). Adding a light
// for him would also fall on the walls, which are already baked, and roughly
// double their brightness — hence the blob shadow below instead of a real one.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

export interface Character {
  /** Move and turn this; the model inside is scaled and floor-aligned. */
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  clips: string[];
  /** Cross-fade to a clip by name. Unknown names are ignored. */
  play: (name: string, fadeSeconds?: number) => void;
  update: (deltaSeconds: number) => void;
  /** What he actually measured before being fitted, in metres. */
  measuredHeight: number;
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
   * The skin that ships inside colin_slim.glb is near-black on the hoodie and
   * jeans (mean albedo 0.0065 over the atlas), which is what makes him read as a
   * silhouette in a bright room. Pointing this at a repainted atlas swaps it
   * without touching the GLB. It is also how the other bodies will be dressed:
   * colin_anim2 and colin_animations_02 export with no map at all.
   */
  baseColorMap?: string;
  /** Lit by the probe like everything unbaked; the room uses 0.25. */
  envMapIntensity?: number;
  /** Clip to start on. Falls back to the first idle, then the first clip. */
  idle?: string;
  dracoPath?: string;
}

export async function loadCharacter(
  url: string,
  {
    height = 1.75, envMapIntensity = 1, idle = 'idle_neutral_00',
    baseColorMap, dracoPath,
  }: LoadCharacterOptions = {},
): Promise<Character> {
  const loader = new GLTFLoader();
  // Not needed by colin_slim, but the other bodies are Draco-compressed.
  const draco = new DRACOLoader();
  if (dracoPath) draco.setDecoderPath(dracoPath);
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync(url);
  draco.dispose();

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
      std.envMapIntensity = envMapIntensity;
      materials.push(std);
    }
  });

  if (baseColorMap) await applyBaseColorMap(materials, baseColorMap);

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

  const clips = gltf.animations.map((c) => c.name);
  const first = clips.find((n) => n === idle) ?? clips.find((n) => n.startsWith('idle')) ?? clips[0];
  if (first) play(first, 0);

  return {
    root, model, mixer, clips, play, measuredHeight, materials,
    setShadowStrength: shadow.setStrength,
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

  const key = new THREE.DirectionalLight(0xfff1de, 2.2);   // warm, window side
  key.position.set(-3, 2.6, 2.2);

  const fill = new THREE.DirectionalLight(0xdCe8ff, 0.8);  // cool, doorway side
  fill.position.set(2.5, 1.6, 1.5);

  const rim = new THREE.DirectionalLight(0xffffff, 3.0);   // behind, for the edge
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
