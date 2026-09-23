// His face: who is allowed to move it, and what moves on its own.
//
// `colin.glb` splits the face across three skinned meshes, and each owns a
// different part of the problem:
//
//   head   42 shapes — the visemes, the brows, the blinks, the cheeks, and
//                      `Colin_Head_MIX`, which is not an expression at all
//   eyes    5 shapes — Look_Left / Right / Up / Down, and Cross_Eyed
//   teeth   1 shape  — Jaw_Open, which nothing else will drive for it
//
// COLIN_HEAD_MIX IS A BASE SHAPE, NOT AN EXPRESSION. It has to sit at 1 for the
// head to be the right head; at 0 he is wearing the shape underneath it. So it
// is written every frame and is the one channel no layer may touch.
//
// Everything else composites here rather than each system writing influences on
// its own. Several things want the face at once — a viseme, a blink, a raised
// brow, a glance — and the only way they do not fight is if one place collects
// what each of them wants and writes the result once.
import * as THREE from 'three';

/** The shape that has to stay on for his head to look like his head. */
export const BASE_SHAPE = 'Colin_Head_MIX';

/** Loose matching, because exporters prefix, suffix and re-case. `MIX` is this
 *  export's suffix on every head shape, so it is stripped along with the rest. */
export const canonicalShapeName = (name: string) =>
  name.toLowerCase().replace(/[^a-z]/g, '').replace(/mix$/, '');
const canon = canonicalShapeName;

export interface FaceRig {
  /** Every mesh carrying morph targets. */
  meshes: THREE.Mesh[];
  /** Set one shape by name, on whichever meshes have it. Unknown names no-op. */
  set: (name: string, value: number) => void;
  /** Read back what a shape is currently at. */
  get: (name: string) => number;
  /** Names of every shape on the face, for the panel and the console. */
  names: string[];
  /** True when this really is the new single-GLB face. */
  ready: boolean;
  /** Write the collected targets onto the meshes. Call once per frame, last. */
  commit: () => void;
  /** Set a shape's target for this frame; cleared by `beginFrame`. */
  want: (name: string, value: number) => void;
  /** Start a frame: everything returns to rest except the base shape. */
  beginFrame: () => void;
}

interface Bound {
  mesh: THREE.Mesh;
  /** canonical name → influence index on this mesh. */
  index: Map<string, number>;
}

export function createFaceRig(model: THREE.Object3D): FaceRig {
  const bound: Bound[] = [];
  const names: string[] = [];
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
    const index = new Map<string, number>();
    for (const [name, i] of Object.entries(mesh.morphTargetDictionary)) {
      index.set(canon(name), i);
      if (!names.includes(name)) names.push(name);
    }
    bound.push({ mesh, index });
  });

  /** What this frame wants, by canonical name. */
  const target = new Map<string, number>();

  const want = (name: string, value: number) => {
    const key = canon(name);
    // Highest bidder wins: a blink at 1 must not be undone by an expression
    // that also has an opinion about the eyelid.
    const prev = target.get(key);
    target.set(key, prev === undefined ? value : Math.max(prev, value));
  };

  const beginFrame = () => {
    target.clear();
    target.set(canon(BASE_SHAPE), 1);
  };

  const commit = () => {
    for (const b of bound) {
      const inf = b.mesh.morphTargetInfluences!;
      for (const [key, i] of b.index) inf[i] = target.get(key) ?? 0;
    }
  };

  const set = (name: string, value: number) => {
    const key = canon(name);
    for (const b of bound) {
      const i = b.index.get(key);
      if (i !== undefined) b.mesh.morphTargetInfluences![i] = value;
    }
  };

  const get = (name: string) => {
    const key = canon(name);
    for (const b of bound) {
      const i = b.index.get(key);
      if (i !== undefined) return b.mesh.morphTargetInfluences![i];
    }
    return 0;
  };

  const ready = bound.some((b) => b.index.has(canon(BASE_SHAPE)));
  if (!ready && bound.length) {
    console.warn(`face: no ${BASE_SHAPE} on this model — his head will be the shape underneath it`);
  }

  beginFrame();
  commit();
  return { meshes: bound.map((b) => b.mesh), set, get, names, ready, want, beginFrame, commit };
}

/* ---------------- the part that moves on its own ---------------- */

export interface AliveConfig {
  enabled: boolean;
  /** Seconds between blinks, roughly. A real one is every 2–10 s, and doubles. */
  blinkMin: number;
  blinkMax: number;
  /** How far the eyes wander when nothing has his attention, 0–1 of the shape. */
  gaze: number;
  /** Seconds a glance is held before he looks somewhere else. */
  gazeMin: number;
  gazeMax: number;
  /** How much the brows drift. Small — this is meant to be felt, not seen. */
  brow: number;
  /**
   * How hard the mood shows on his face, 0–2.
   *
   * ABOVE ONE ON PURPOSE. The brow shapes on this rig are far subtler than the
   * mouth ones — measured across a rendered frame, a full smile changes 19% of
   * the pixels on his face and a full brow drop changes 12% — so at the
   * authored weights a strong mood came out as a clear grin and two kinds of
   * almost-nothing. Cross and sad were the same face, which defeats the point
   * of having two axes at all.
   *
   * What this actually buys is the MIDDLE of the range: a half-felt mood at 1.0
   * moves the brows by an amount you can measure and cannot see. The strongest
   * shapes clip at the extremes, which is the right trade — a maxed-out mood
   * ought to look maxed out.
   *
   * Turn it down if he starts gurning. At 0 his face stops carrying the mood
   * at all, which is what this looked like before.
   */
  feeling: number;
}

export const DEFAULT_ALIVE: AliveConfig = {
  enabled: true,
  blinkMin: 3.2,
  blinkMax: 9,
  gaze: 0.5,
  gazeMin: 1.1,
  gazeMax: 3.4,
  brow: 0.18,
  feeling: 1.5,
};

/** A blink, start to finish. Fast down, slightly slower up — the shut is almost
 *  instant on a real face and the opening is what you actually perceive. */
const BLINK_CLOSE = 0.055;
const BLINK_HOLD = 0.02;
const BLINK_OPEN = 0.115;
const BLINK_TOTAL = BLINK_CLOSE + BLINK_HOLD + BLINK_OPEN;

export interface Alive {
  update: (dt: number, face: FaceRig) => void;
  config: AliveConfig;
  /** Aim the eyes. x and y in -1..1, where +x is his left and +y is up.
   *  Null hands them back to their own wandering. */
  lookAt: (x: number | null, y?: number) => void;
  /** Hold an expression for a while, by name. */
  express: (name: ExpressionName, seconds?: number) => void;
  /** Blink now — used when he starts speaking, which is when people do. */
  blinkNow: () => void;
  /**
   * How he is feeling, held under everything else. See mood.ts for the axes.
   *
   * The difference from `express` is the whole point: an expression is a beat
   * and this is a state. A face that only ever does two-second expressions and
   * returns to dead level between them is a face nobody is behind — a mood has
   * to still be on him while he is talking about something else.
   */
  setFeeling: (valence: number, energy: number) => void;
}

export type ExpressionName = 'neutral' | 'thinking' | 'amused' | 'doubtful' | 'surprised' | 'listening';

/**
 * Expressions as weights on the shapes that are already there.
 *
 * Deliberately understated. These run underneath speech and behind a mouth that
 * is doing something else, so anything strong enough to read on its own reads as
 * a grimace in motion.
 */
const EXPRESSIONS: Record<ExpressionName, Record<string, number>> = {
  neutral: {},
  thinking: { Brow_Compress_L: 0.35, Brow_Compress_R: 0.35, Brow_Drop_L: 0.2, Eye_Squint_L: 0.18, Eye_Squint_R: 0.18 },
  amused: { Mouth_Smile_L: 0.3, Mouth_Smile_R: 0.3, Cheek_Raise_L: 0.35, Cheek_Raise_R: 0.35, Eye_Squint_L: 0.22, Eye_Squint_R: 0.22 },
  doubtful: { Brow_Raise_Outer_L: 0.55, Brow_Drop_R: 0.3, Eye_Squint_R: 0.25, Mouth_Press_R: 0.2 },
  surprised: { Brow_Raise_Inner_L: 0.6, Brow_Raise_Inner_R: 0.6, Brow_Raise_Outer_L: 0.5, Brow_Raise_Outer_R: 0.5 },
  listening: { Brow_Raise_Inner_L: 0.22, Brow_Raise_Inner_R: 0.22 },
};

/**
 * The four corners of the mood plane, plus the middle of its top edge.
 *
 * Bilinear between them, so every pair of numbers lands somewhere on a real
 * face rather than on one of five presets: half a smile is half of these
 * weights, and pleased-but-tired is genuinely between the grin and the small
 * warm one instead of being either.
 *
 * SAD AND CROSS ARE THE SAME UNHAPPINESS AT DIFFERENT ENERGIES, which is the
 * reason for two axes and the reason these are corners rather than a list. The
 * brows do most of it in both, in opposite directions: down and together is
 * angry, and the inner ends lifted is the one shape that reads as sad on
 * anybody.
 */
const FEELING_FACE: Record<'happy' | 'warm' | 'cross' | 'low' | 'alert', Record<string, number>> = {
  // valence up, energy up — the whole face is in it.
  happy: {
    Mouth_Smile_L: 0.85, Mouth_Smile_R: 0.85, Mouth_Smile_Sharp_L: 0.35, Mouth_Smile_Sharp_R: 0.35,
    Cheek_Raise_L: 0.8, Cheek_Raise_R: 0.8, Eye_Squint_L: 0.42, Eye_Squint_R: 0.42,
    Brow_Raise_Outer_L: 0.25, Brow_Raise_Outer_R: 0.25,
  },
  // valence up, energy down — pleased, and not making a thing of it.
  warm: {
    Mouth_Smile_L: 0.42, Mouth_Smile_R: 0.42, Cheek_Raise_L: 0.32, Cheek_Raise_R: 0.32,
    Eye_Squint_L: 0.18, Eye_Squint_R: 0.18,
  },
  // valence down, energy up — cross. The mouth is pressed rather than frowning:
  // a big frown on a man mid-sentence reads as a pantomime, and the brows are
  // what anybody actually reads anger off.
  cross: {
    Brow_Drop_L: 0.95, Brow_Drop_R: 0.95, Brow_Compress_L: 0.85, Brow_Compress_R: 0.85,
    Eye_Squint_L: 0.45, Eye_Squint_R: 0.45, Mouth_Press_L: 0.6, Mouth_Press_R: 0.6,
    Mouth_Frown_L: 0.3, Mouth_Frown_R: 0.3,
  },
  // valence down, energy down — sad, and the lids carry some of it.
  low: {
    Mouth_Frown_L: 0.75, Mouth_Frown_R: 0.75,
    Brow_Raise_Inner_L: 0.85, Brow_Raise_Inner_R: 0.85,
    Brow_Drop_L: 0.15, Brow_Drop_R: 0.15, Eye_Blink_L: 0.22, Eye_Blink_R: 0.22,
  },
  // Neither way in particular, but wound up: wide and watchful.
  alert: {
    Brow_Raise_Inner_L: 0.5, Brow_Raise_Inner_R: 0.5,
    Brow_Raise_Outer_L: 0.6, Brow_Raise_Outer_R: 0.6,
  },
};

/** Seconds for the face to get most of the way to a new feeling. Slow enough
 *  that nothing snaps when the slider moves, fast enough that a remark lands
 *  while the sentence after it is still going. */
const FEELING_EASE = 0.75;

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export function createAlive(config: AliveConfig = { ...DEFAULT_ALIVE }): Alive {
  let blinkIn = rand(config.blinkMin, config.blinkMax);
  let blinking = -1;
  /* Blinks come in pairs more often than you would think, and a face that
     blinks on a perfectly random schedule reads as a metronome. */
  let doubleBlink = false;

  let gazeIn = rand(config.gazeMin, config.gazeMax);
  const gazeTo = new THREE.Vector2();
  const gazeNow = new THREE.Vector2();
  let held: { x: number; y: number } | null = null;

  let expression: ExpressionName = 'neutral';
  let expressionFor = 0;
  const browPhase = [Math.random() * 10, Math.random() * 10];

  /** Where the feeling is going, and where the face has got to. */
  let wantValence = 0;
  let wantEnergy = 0;
  let feltValence = 0;
  let feltEnergy = 0;
  /** Reused every frame; this runs in the render loop. */
  const blended = new Map<string, number>();

  const pickGaze = () => {
    /* Mostly small, occasionally not. Eyes at rest make tiny saccades around
       whatever they are pointed at and now and then break off somewhere else,
       and using one distribution for both makes him look shifty. */
    const far = Math.random() < 0.25;
    const r = far ? config.gaze : config.gaze * 0.35;
    gazeTo.set(rand(-r, r), rand(-r * 0.6, r * 0.6));
    gazeIn = far ? rand(config.gazeMin, config.gazeMax) : rand(0.35, 1.2);
  };
  pickGaze();

  const update = (dt: number, face: FaceRig) => {
    if (!config.enabled) return;

    // --- blink ---
    if (blinking >= 0) {
      blinking += dt;
      if (blinking >= BLINK_TOTAL) {
        blinking = -1;
        if (doubleBlink) { doubleBlink = false; blinkIn = rand(0.12, 0.22); }
        else blinkIn = rand(config.blinkMin, config.blinkMax);
      }
    } else {
      blinkIn -= dt;
      if (blinkIn <= 0) { blinking = 0; doubleBlink = Math.random() < 0.3; }
    }
    if (blinking >= 0) {
      const t = blinking;
      const shut = t < BLINK_CLOSE ? t / BLINK_CLOSE
        : t < BLINK_CLOSE + BLINK_HOLD ? 1
          : 1 - (t - BLINK_CLOSE - BLINK_HOLD) / BLINK_OPEN;
      const v = Math.max(0, Math.min(1, shut));
      face.want('Eye_Blink_L', v);
      face.want('Eye_Blink_R', v);
    }

    // --- gaze ---
    if (held) {
      gazeTo.set(held.x * config.gaze, held.y * config.gaze);
    } else {
      gazeIn -= dt;
      if (gazeIn <= 0) pickGaze();
    }
    // Saccades are fast: eyes snap and then sit still, they do not glide.
    gazeNow.lerp(gazeTo, 1 - Math.pow(0.0001, dt));
    if (gazeNow.x > 0) face.want('Look_Left', gazeNow.x);
    else face.want('Look_Right', -gazeNow.x);
    if (gazeNow.y > 0) face.want('Look_Up', gazeNow.y);
    else face.want('Look_Down', -gazeNow.y);

    // --- expression, and the brow drift underneath it ---
    if (expressionFor > 0) {
      expressionFor -= dt;
      if (expressionFor <= 0) expression = 'neutral';
    }
    for (const [name, v] of Object.entries(EXPRESSIONS[expression])) face.want(name, v);

    /* --- and the feeling underneath all of it ---
       Written every frame, after the transient expression and before the brow
       drift, so that `want`'s highest-bidder rule leaves a deliberate beat on
       top of a mood rather than the mood erasing it. */
    const k = 1 - Math.pow(0.02, dt / FEELING_EASE);
    feltValence += (wantValence - feltValence) * k;
    feltEnergy += (wantEnergy - feltEnergy) * k;
    blended.clear();
    const pos = Math.max(0, feltValence);
    const neg = Math.max(0, -feltValence);
    const up = (feltEnergy + 1) / 2;
    const mix = (pose: Record<string, number>, weight: number) => {
      if (weight <= 0.004) return;
      for (const [name, v] of Object.entries(pose)) {
        blended.set(name, (blended.get(name) ?? 0) + v * weight);
      }
    };
    mix(FEELING_FACE.happy, pos * up);
    mix(FEELING_FACE.warm, pos * (1 - up));
    mix(FEELING_FACE.cross, neg * up);
    mix(FEELING_FACE.low, neg * (1 - up));
    // Only where he is not clearly one way or the other: a grin does not also
    // need startled brows on top of it.
    mix(FEELING_FACE.alert, (1 - Math.abs(feltValence)) * Math.max(0, feltEnergy));
    for (const [name, v] of blended) face.want(name, Math.min(1, v * config.feeling));

    /* Two slow sine waves at different rates, which never line up, so the brows
       are never quite still and never obviously cycling. */
    browPhase[0] += dt * 0.37;
    browPhase[1] += dt * 0.23;
    const l = (Math.sin(browPhase[0]) * 0.5 + 0.5) * config.brow;
    const r = (Math.sin(browPhase[1] + 1.7) * 0.5 + 0.5) * config.brow;
    face.want('Brow_Raise_Inner_L', l);
    face.want('Brow_Raise_Inner_R', r);
  };

  return {
    update,
    config,
    lookAt: (x, y = 0) => { held = x === null ? null : { x, y }; if (x === null) pickGaze(); },
    express: (name, seconds = 2.5) => { expression = name; expressionFor = seconds; },
    blinkNow: () => { if (blinking < 0) { blinking = 0; doubleBlink = false; } },
    setFeeling: (valence, energy) => {
      wantValence = Math.max(-1, Math.min(1, valence));
      wantEnergy = Math.max(-1, Math.min(1, energy));
    },
  };
}
