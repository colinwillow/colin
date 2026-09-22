// Something for him to stand on, in a room with nothing in it.
//
// A white sweep with a figure floating in it is a cut-out. What makes it a
// PLACE is one thing: a shadow on the floor that is the shape of him. The blob
// under his feet — see `makeContactShadow` in character.ts — is a good cheat
// against a baked kitchen floor where it only has to say "he is touching the
// ground". On an empty white plane it says "someone has put an oval here".
//
// So this is a real one: a light above him, a shadow map, and a plane that is
// invisible except where the shadow falls on it. It follows his pose, stretches
// when he leans, separates under a raised foot, and costs one extra pass over
// his six meshes — which is nothing next to the room.
//
// TWO THINGS ABOUT `ShadowMaterial`, both of which matter here:
//
//   It renders NOTHING but the shadow. Everywhere else the plane is completely
//   transparent, so the sweep behind it comes through untouched and there is no
//   horizon line where the floor ends — which is what makes it read as an
//   infinite space rather than a room with a white wall in it.
//
//   It needs a light that casts. The light is kept dim on purpose: its job is to
//   throw the shadow, not to relight him. He is already lit by the sweep and by
//   his own three-point rig, and a fourth light bright enough to be seen would
//   have to be undone everywhere else.
import * as THREE from 'three';
import type { Character } from './character';

export interface GroundConfig {
  /** How dark the shadow is at its darkest, 0–1. */
  opacity: number;
  /** How much light the shadow-caster itself adds. Low: it is not a key. */
  light: number;
  /** Degrees around him the light sits, 0 = behind the camera. */
  azimuthDeg: number;
  /** Degrees above the horizon. Higher is a tighter, shorter shadow. */
  elevationDeg: number;
  /** How soft the edge is, in shadow-map texels. At this coverage and map size
   *  one texel is about 3 mm, so 9 is a centimetres-wide penumbra — which is
   *  what stops it looking like a stencil. */
  blur: number;
}

export const DEFAULT_GROUND: GroundConfig = {
  opacity: 0.17,
  light: 0.22,
  azimuthDeg: 18,
  elevationDeg: 58,
  blur: 9,
};

export interface Ground {
  group: THREE.Group;
  config: GroundConfig;
  /** Studio on, room off. The kitchen has its own baked floor and its own
   *  baked shadows, and a second set laid over them is two shadows. */
  set: (on: boolean) => void;
  readonly on: boolean;
  /** Push the config at the light and the plane. */
  apply: () => void;
  /** Per frame: the shadow camera follows him, so it can stay tight. */
  update: () => void;
}

/** How much floor the shadow map covers, in metres. Tight, because the whole
 *  quality of a soft shadow is texels per metre and he is two metres tall. */
const COVERAGE = 3.2;

export function createGround(
  renderer: THREE.WebGLRenderer,
  colin: Character,
  config: GroundConfig = { ...DEFAULT_GROUND },
): Ground {
  const group = new THREE.Group();
  group.name = 'Ground';
  group.visible = false;

  /* Enabled once and left alone. A shadow map with nothing casting into it costs
     nothing, and toggling this global is how two features that both want
     shadows end up turning each other off — the room-lights experiment owns the
     same flag. Which lights actually cast is the per-light switch below. */
  renderer.shadowMap.enabled = true;
  /* PCF, NOT PCFSoft — and that is not a preference. In r185 the soft type is no
     longer a shader define at all: `shadowMapTypeDefines` maps only PCF and VSM,
     so PCFSoftShadowMap falls through to SHADOWMAP_TYPE_BASIC, which is a single
     hard tap that ignores `radius` entirely. Asking for the softest setting in
     this version gets you the hardest one. */
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const light = new THREE.DirectionalLight(0xffffff, config.light);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  const shadowCamera = light.shadow.camera;
  shadowCamera.left = -COVERAGE / 2;
  shadowCamera.right = COVERAGE / 2;
  shadowCamera.top = COVERAGE / 2;
  shadowCamera.bottom = -COVERAGE / 2;
  shadowCamera.near = 0.5;
  shadowCamera.far = 14;
  shadowCamera.updateProjectionMatrix();
  /* Bias against acne, normalBias against the ring of light that otherwise
     appears where his shoes meet the floor. Small: too much of either and the
     shadow detaches from his feet, which is the one thing it is here to do. */
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.018;
  group.add(light, light.target);

  /* Big enough to reach past the frame at any of the shots, and flat. It only
     ever renders where the shadow is, so its size costs nothing. */
  const material = new THREE.ShadowMaterial({ opacity: config.opacity });
  material.transparent = true;
  // It covers the whole frame and is drawn after him; writing depth from it can
  // only ever reject something, never help.
  material.depthWrite = false;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), material);
  plane.rotation.x = -Math.PI / 2;
  // A hair above zero, below the contact blob, so the two never z-fight.
  plane.position.y = 0.002;
  plane.receiveShadow = true;
  plane.renderOrder = -2;
  group.add(plane);

  /* He has to be told to cast, and only the meshes that are actually him: the
     contact blob is a flat multiply card and would cast a hard rectangle. */
  colin.model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.name === 'ContactShadow' || mesh.name.endsWith('_Outline')) return;
    mesh.castShadow = true;
  });

  const apply = () => {
    light.intensity = config.light;
    material.opacity = config.opacity;
    light.shadow.radius = Math.max(0.5, config.blur);
    const az = THREE.MathUtils.degToRad(config.azimuthDeg);
    const el = THREE.MathUtils.degToRad(config.elevationDeg);
    const r = 6;
    light.position.set(
      Math.sin(az) * Math.cos(el) * r,
      Math.sin(el) * r,
      Math.cos(az) * Math.cos(el) * r,
    );
  };

  const offset = light.position.clone();
  const foot = new THREE.Vector3();

  const update = () => {
    if (!group.visible) return;
    /* The shadow camera is only 3.2 m across, so it has to go where he is. The
       light keeps its direction — it is moved, not re-aimed — or the shadow
       would swing round him as he walked. */
    colin.root.getWorldPosition(foot);
    light.target.position.set(foot.x, 0, foot.z);
    light.position.copy(offset).add(light.target.position);
    light.target.updateMatrixWorld();
  };

  apply();
  offset.copy(light.position);

  return {
    group,
    config,
    set: (on) => {
      group.visible = on;
      light.castShadow = on;
      /* The blob and this are two answers to the same question. In a studio the
         real one wins and the blob is turned down to a whisper — just enough to
         darken the last centimetre under his soles, which a shadow map at this
         resolution cannot resolve and which is most of what sells contact. */
      colin.setShadowStrength(on ? 0.3 : 1);
    },
    get on() { return group.visible; },
    /* `apply` leaves the light at its bare offset from the origin, which is
       exactly what `update` then adds his position to. */
    apply: () => { apply(); offset.copy(light.position); },
    update,
  };
}
