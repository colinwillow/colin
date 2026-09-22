// Where he is standing: the baked kitchen, or a studio with nothing in it.
//
// The kitchen is a photograph — path-traced, lightmapped, one lighting state —
// and everything about how he is lit was tuned to sit inside it. A studio is the
// opposite: no room, one colour behind him, and light that comes from that
// colour. So switching is not "hide the walls". It is a different environment
// probe, a different exposure, a different emission level on his own materials,
// and a camera that stops following him and starts framing him.
//
// All of that lives here, in one table, so a new backdrop is five numbers rather
// than an afternoon.
//
// THE BACKDROP IS ALSO THE LIGHT. A studio cyclorama works because the sweep is
// what lights the subject — so the gradient behind him is generated once, used
// as the background, and then pre-filtered into the environment map. Change the
// colour and his skin changes with it, which is the entire reason a white cyc
// and a black one look nothing alike.
//
// The sweep is a SPHERE AROUND THE ROOM rather than `scene.background`, and that
// is not a stylistic choice. A scene background goes through the tone curve, and
// the room's curve is AgX at 0.55 exposure — which turned a white cyc into mid
// grey and a slate one into black, because compressing the highlights is exactly
// what that curve is for. A mesh can opt out with `toneMapped: false`, so the
// backdrop comes out the colour it was asked for and only the character is
// graded.
import * as THREE from 'three';
import type { Character, CharacterLights } from './character';
import type { ShotDirector, ShotName } from './shot';
import type { Ground } from './ground';
import type { LookBase } from './look';

export interface Backdrop {
  /** The colour of the sweep at eye level. */
  color: string;
  /** How much brighter the top is, and how much darker the floor. */
  lift?: number;
}

export interface StageScene {
  id: string;
  name: string;
  /** One line under the name, in the picker. */
  note: string;
  /** The baked room, or a studio sweep. */
  kind: 'room' | 'studio';
  backdrop?: Backdrop;
  /** He walks around a room; he stands on a mark in a studio. */
  wander: boolean;
  /** Exposure for his pass. The room and the studio are lit nothing alike. */
  exposure: number;
  /** His own materials' share of the environment. */
  envMapIntensity: number;
  /** The diffuse-as-emission trick that carries his level in the dark kitchen.
   *  A studio has real light in it and needs far less of it. */
  emissiveIntensity: number;
  /** How hard his own three lights work here. */
  lights: { key: number; fill: number; rim: number };
  /** How dark the blob under him is. */
  shadow: number;
  /** The framing this scene opens on, or null to leave the camera on the rig. */
  shot: ShotName | null;
}

/* The kitchen's numbers are the ones already dialled in against the bake — see
   main.ts, which passes the same values into `loadCharacter`. They are repeated
   here because switching back has to restore them exactly. */
const KITCHEN: StageScene = {
  id: 'kitchen',
  name: 'Kitchen',
  note: 'Baked in Blender. He walks around it.',
  kind: 'room',
  wander: true,
  exposure: 0.58,
  envMapIntensity: 1.1,
  emissiveIntensity: 0.72,
  lights: { key: 0.3, fill: 0.6, rim: 0.5 },
  shadow: 1,
  shot: null,
};

/* Studio numbers are a different balance and not a tweak of the kitchen's. The
   sweep is a real light source, so the emission that carries him in the dark
   room is mostly turned off and the environment does the work instead — leave it
   at the kitchen's 0.72 and he glows like a lamp. */
const studio = (
  id: string, name: string, note: string, color: string,
  over: Partial<StageScene> = {},
): StageScene => ({
  id,
  name,
  note,
  kind: 'studio',
  backdrop: { color },
  wander: false,
  exposure: 0.62,
  envMapIntensity: 1,
  emissiveIntensity: 0.3,
  lights: { key: 0.85, fill: 0.45, rim: 1.1 },
  shadow: 0.85,
  shot: 'standing',
  ...over,
});

/* PAPER IS FIRST and is what the app opens on. The kitchen is the better piece
   of work and is still one tap away, but a plain warm space is the right thing
   to look at while you are talking to somebody: nothing in it competes with him,
   and it reads as a place he is rather than a set he is standing on. Warm rather
   than white because skin on a cold white sweep goes grey, and because the whole
   interface is built out of the colours in it. */
export const SCENES: StageScene[] = [
  studio('paper', 'Paper', 'Warm off-white. Softer on skin than white.', '#e8e0d3', {
    // Barely any sweep at all. A visible gradient behind him is a wall, and the
    // thing being aimed at here is a space with no back to it.
    backdrop: { color: '#e8e0d3', lift: 0.07 },
  }),
  studio('white', 'Studio', 'An empty white room with a floor.', '#f7f6f4', {
    backdrop: { color: '#f7f6f4', lift: 0.07 },
  }),
  KITCHEN,
  studio('slate', 'Slate', 'Dark and moody. The rim light earns its keep.', '#2a2d33', {
    exposure: 0.72, lights: { key: 1.1, fill: 0.4, rim: 1.8 }, shadow: 0.55,
  }),
  studio('mint', 'Mint', 'Colour comes off the wall and onto him.', '#bfe0d2'),
  studio('sunset', 'Sunset', 'Low warm wash, like the end of a day.', '#e0a071', {
    exposure: 0.66,
  }),
];

export interface Stage {
  scenes: StageScene[];
  readonly current: StageScene;
  /** The backdrop's material, so the look knobs can dim the sweep. */
  readonly sky: THREE.MeshBasicMaterial;
  /** What the room just asked for. `look.ts` multiplies its own taste onto this
   *  — the room decides the baseline, and something else decides the rest. */
  readonly base: LookBase;
  /** Called after every change of room, with that baseline. */
  onScene?: (base: LookBase) => void;
  go: (id: string, immediate?: boolean) => void;
  /** Change the framing without changing the scene. `undefined` means "whatever
   *  this scene opens on", which is not the same as `null` — null is the rig. */
  frame: (shot: ShotName | null | undefined, immediate?: boolean) => void;
  dispose: () => void;
}

/**
 * A vertical sweep, as an equirectangular strip.
 *
 * EIGHT-BIT, NOT FLOAT, AND THAT IS THE WHOLE BUG THIS ONCE HAD. Every backdrop
 * rendered black on iOS while being perfect in Chromium, because the strip was a
 * `FloatType` DataTexture with `LinearFilter` on it — and linear filtering of a
 * 32-bit float texture needs `OES_texture_float_linear`, which Safari does not
 * expose. A texture whose filter the driver cannot honour is INCOMPLETE, and an
 * incomplete texture samples as solid black rather than failing loudly. It is an
 * 11 KB colour ramp; there was never anything float about it worth having.
 *
 * Four pixels wide rather than one: there is no horizontal variation in a cyc,
 * but a one-pixel-wide texture is a shape some drivers have opinions about and
 * the whole thing is 4 KB either way.
 */
function makeSweep(renderer: THREE.WebGLRenderer, backdrop: Backdrop) {
  const lift = backdrop.lift ?? 0.22;
  const base = new THREE.Color(backdrop.color);
  const top = base.clone().lerp(new THREE.Color(1, 1, 1), lift * 0.9);
  /* The floor of the sweep barely darkens. A cyclorama that visibly gets darker
     toward the bottom draws a horizon, and a horizon turns an infinite space
     into a room — the shadow on the ground is what says there is a floor. */
  const floor = base.clone().multiplyScalar(1 - lift * 0.9);

  const width = 4;
  const height = 256;
  const data = new Uint8Array(width * height * 4);
  const c = new THREE.Color();
  for (let y = 0; y < height; y++) {
    // v runs top to bottom. The horizon sits a little below centre, which is
    // where the sweep meets the floor on a real cyc.
    const v = y / (height - 1);
    if (v < 0.56) c.copy(top).lerp(base, v / 0.56);
    else c.copy(base).lerp(floor, (v - 0.56) / 0.44);
    /* The colours above are in sRGB, and the texture is declared sRGB below, so
       they are written as-is and the shader does the decoding. Mixing in sRGB is
       not physically how light adds up, but this is a painted backdrop rather
       than a render of one, and it is the space the colours were chosen in. */
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = Math.round(c.r * 255);
      data[i + 1] = Math.round(c.g * 255);
      data[i + 2] = Math.round(c.b * 255);
      data[i + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromEquirectangular(texture).texture;
  pmrem.dispose();

  /* A second copy for the sphere. The environment wants the strip the way an
     equirectangular probe is addressed — v increasing downward — and a sphere's
     own UVs run the other way, so one of the two has to be flipped and the probe
     is the one that must not be. */
  const painted = texture.clone();
  painted.mapping = THREE.UVMapping;
  painted.flipY = true;
  painted.needsUpdate = true;
  return { sky: painted, envMap };
}

export interface StageParts {
  renderer: THREE.WebGLRenderer;
  /** The room's scene, which owns the background. */
  scene: THREE.Scene;
  /** His scene, which owns the environment he is lit by. */
  characterScene: THREE.Scene;
  room: THREE.Object3D;
  /** The kitchen's own probe, restored when he goes back into it. */
  roomEnvMap: THREE.Texture;
  colin: Character;
  lights: CharacterLights;
  /** His pass's tone mapping, which main.ts reads every frame. */
  look: { exposure: number };
  wander: { config: { enabled: boolean }; halt: () => void };
  shots: ShotDirector;
  /** The studio floor and the shadow that lands on it. */
  ground: Ground;
}

/** Where he was standing last time. A room is a setting, not a session. */
const KEY = 'colin.room.v1';

export function createStage(parts: StageParts): Stage {
  const {
    renderer, scene, characterScene, room, roomEnvMap, colin, lights, look, wander, shots, ground,
  } = parts;

  /** Built once each, the first time a backdrop is asked for. */
  const sweeps = new Map<string, { sky: THREE.Texture; envMap: THREE.Texture }>();
  let current = SCENES[0];

  /* The cyc. Big enough to be outside anything, small enough to be inside the
     camera's far plane, and never culled — a sphere the camera is inside of has
     a bounding sphere the frustum test does not like. */
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 24),
    new THREE.MeshBasicMaterial({ side: THREE.BackSide, toneMapped: false, depthWrite: false }),
  );
  sky.name = 'Backdrop';
  sky.scale.setScalar(40);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.visible = false;
  scene.add(sky);

  /** The room's own numbers, kept so a look change can be re-applied without a
   *  change of room. Overwritten by `go`. */
  let base: LookBase = {
    exposure: current.exposure,
    emissiveIntensity: current.emissiveIntensity,
    envMapIntensity: current.envMapIntensity,
    key: current.lights.key,
    fill: current.lights.fill,
    rim: current.lights.rim,
  };

  const sweepFor = (id: string, backdrop: Backdrop) => {
    let made = sweeps.get(id);
    if (!made) { made = makeSweep(renderer, backdrop); sweeps.set(id, made); }
    return made;
  };

  const go = (id: string, immediate = false) => {
    const next = SCENES.find((s) => s.id === id);
    if (!next) return;
    current = next;
    try { localStorage.setItem(KEY, next.id); } catch { /* private mode */ }

    if (next.kind === 'studio' && next.backdrop) {
      const sweep = sweepFor(next.id, next.backdrop);
      room.visible = false;
      sky.visible = true;
      (sky.material as THREE.MeshBasicMaterial).map = sweep.sky;
      (sky.material as THREE.MeshBasicMaterial).needsUpdate = true;
      characterScene.environment = sweep.envMap;
    } else {
      room.visible = true;
      sky.visible = false;
      characterScene.environment = roomEnvMap;
    }

    base = {
      exposure: next.exposure,
      emissiveIntensity: next.emissiveIntensity,
      envMapIntensity: next.envMapIntensity,
      key: next.lights.key,
      fill: next.lights.fill,
      rim: next.lights.rim,
    };
    look.exposure = base.exposure;
    for (const m of colin.materials) {
      m.envMapIntensity = base.envMapIntensity;
      m.emissiveIntensity = base.emissiveIntensity;
    }
    lights.key.intensity = base.key;
    lights.fill.intensity = base.fill;
    lights.rim.intensity = base.rim;
    colin.setShadowStrength(next.shadow);
    /* Last, and after the blob: in a studio this turns the blob down to a
       whisper and puts a real shadow on the floor instead. */
    ground.set(next.kind === 'studio');
    // And now whatever taste is sitting on top of the room's numbers.
    api.onScene?.(base);

    /* A studio has no floor to walk on and no room to walk around, so he is put
       back on his mark and told to stand still — and turned to face the front,
       so that the turntable starts where you would expect and "0 degrees" means
       the same thing every time you come back. */
    if (!next.wander) {
      wander.halt();
      wander.config.enabled = false;
      colin.root.rotation.y = 0;
    } else {
      wander.config.enabled = true;
    }

    shots.set(next.shot, immediate);
  };

  const api: Stage = {
    scenes: SCENES,
    get current() { return current; },
    get sky() { return sky.material as THREE.MeshBasicMaterial; },
    get base() { return base; },
    go,
    frame: (shot, immediate) => shots.set(shot === undefined ? current.shot : shot, immediate),
    dispose: () => {
      for (const s of sweeps.values()) { s.sky.dispose(); s.envMap.dispose(); }
      sweeps.clear();
      sky.geometry.dispose();
      (sky.material as THREE.Material).dispose();
      sky.removeFromParent();
    },
  };
  /* APPLIED, not assumed. `current` starts as the first scene in the table, but
     nothing in the world has been told about it — the room is still visible, the
     sweep has never been built, and the camera is on the rig. A default that is
     only ever a variable is a default that never happens.
     Straight in, with no ease: this runs while the loading overlay is still up,
     and a camera flying to its mark behind it would arrive mid-flight. */
  let opening = current.id;
  try { opening = localStorage.getItem(KEY) || opening; } catch { /* no storage */ }
  go(opening, true);

  return api;
}
