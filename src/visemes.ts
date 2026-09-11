// Mouth shapes, and the machinery that turns a spoken sentence into a sequence
// of them. Ported from the Orb/glorp page, where all of this was worked out.
//
// TIMED FROM THE TEXT, ANCHORED TO THE AUDIO. Driving a mouth off the live
// waveform is the obvious approach and the weaker one: a level meter knows how
// loud he is, not what he is saying, so you get a jaw flapping in time with the
// syllables and forming none of them. ElevenLabs will hand back a start and an
// end time for every character it spoke, which is the real thing — silent
// letters get a near-zero span, and letters sharing one sound get spans that
// abut, so "ough" collapses to one hold instead of four flickers.
import type * as THREE from 'three';
import type { GraftedHead } from './head';

export type Shape = 'rest' | 'MBP' | 'FV' | 'E' | 'AI' | 'O' | 'U' | 'WQ' | 'L' | 'etc';

/**
 * The Preston Blair chart, which is why there is an `etc` and a `rest`: etc is
 * the generic consonant — C, D, G, K, N, R, S, Th, Y, Z, every sound the mouth
 * barely changes for — and rest is the closed idle. Ten shapes has been the
 * working set for hand-drawn animation since the forties because it is the
 * fewest that still reads as speech.
 *
 * Letters, not phonemes, and that is a real limit: English spelling lies about
 * vowels, so "car" and "cat" get the same shape. The character timings do most
 * of the work the spelling cannot.
 */
const SHAPE_OF: Record<string, Shape> = {
  a: 'AI', i: 'AI', y: 'AI',
  e: 'E',
  o: 'O',
  u: 'U',
  w: 'WQ', q: 'WQ',
  l: 'L',
  f: 'FV', v: 'FV',
  m: 'MBP', b: 'MBP', p: 'MBP',
};

/** How long each shape wants relative to the others, when guessing from text
 *  alone. A vowel is the part of a syllable you can hear; a consonant is mostly
 *  the move into it. */
const HOLD: Record<Shape, number> = {
  AI: 2.2, E: 2.0, O: 2.2, U: 2.0, WQ: 1.6, L: 1.2,
  FV: 1.2, MBP: 1.0, etc: 1.0, rest: 1.6,
};

const MIN_HOLD = 0.055;    // seconds; under this a shape cannot be seen
const REST_GAP = 0.12;     // a space shorter than this is not a pause

export interface Span { shape: Shape; t0: number; t1: number }

/** The alignment ElevenLabs returns alongside the audio. */
export interface Alignment {
  characters?: unknown[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
}

/**
 * A viseme is never worth deleting.
 *
 * The obvious rule — drop any shape shorter than MIN_HOLD, hand its time to the
 * one before — is catastrophic for short words: the "I" in "Hello, I am" is one
 * character and maybe 40 ms of audio, with a space either side, so it got
 * absorbed into a rest and the mouth did not move. The face went dead on
 * exactly the words a face should be most alive on.
 *
 * Rests are the compressible thing. So: absorb short rests, never short
 * visemes, and when a viseme is too brief let it borrow from a rest beside it.
 * Total length is untouched, so the audio stays in sync.
 */
function tighten(seq: Span[]): Span[] {
  const out: Span[] = [];
  for (const e of seq) {
    const prev = out[out.length - 1];
    if (e.shape === 'rest' && e.t1 - e.t0 < MIN_HOLD && prev) { prev.t1 = e.t1; continue; }
    out.push({ shape: e.shape, t0: e.t0, t1: e.t1 });
  }
  for (let i = 0; i < out.length; i++) {
    const e = out[i];
    if (e.shape === 'rest' || e.t1 - e.t0 >= MIN_HOLD) continue;
    let need = MIN_HOLD - (e.t1 - e.t0);
    const next = out[i + 1], prev = out[i - 1];
    if (next && next.shape === 'rest') {
      const give = Math.min(need, Math.max(0, (next.t1 - next.t0) - 0.02));
      e.t1 += give; next.t0 += give; need -= give;
    }
    if (need > 0 && prev && prev.shape === 'rest') {
      const give = Math.min(need, Math.max(0, (prev.t1 - prev.t0) - 0.02));
      e.t0 -= give; prev.t1 -= give;
    }
    // Nothing to borrow from: a short shape still beats no shape.
  }
  return out.filter((e) => e.t1 > e.t0);
}

/** Character timings from the voice engine → shapes. `offset` is where this
 *  piece of the reply was actually scheduled, since a reply is spoken a
 *  sentence at a time and each piece's alignment starts from zero. */
export function timelineFromMarks(a: Alignment, offset = 0): Span[] {
  const ch = a.characters ?? [];
  const t0 = a.character_start_times_seconds ?? [];
  const t1 = a.character_end_times_seconds ?? [];
  if (!ch.length || ch.length !== t0.length) return [];
  const seq: Span[] = [];
  for (let i = 0; i < ch.length; i++) {
    const c = String(ch[i]).toLowerCase();
    const s0 = +t0[i] + offset;
    const s1 = +(t1[i] ?? t0[i]) + offset;
    if (!(s1 >= s0)) continue;
    let shape: Shape;
    if (c >= 'a' && c <= 'z') shape = SHAPE_OF[c] ?? 'etc';
    else if (/[.,;:!?]/.test(c)) shape = 'rest';
    // A space inside a phrase is not a pause; only a real gap closes the mouth.
    else if (c === ' ') { if (s1 - s0 < REST_GAP) continue; shape = 'rest'; }
    else continue;
    const last = seq[seq.length - 1];
    if (last && last.shape === shape) last.t1 = s1;    // one sound, however spelt
    else seq.push({ shape, t0: s0, t1: s1 });
  }
  return tighten(seq);
}

/** The fallback when marks were not asked for or did not arrive: spread the
 *  letters over the duration the decoded audio turned out to have. */
export function timelineFromText(text: string, duration: number): Span[] {
  const seq: { shape: Shape; w: number }[] = [];
  const src = String(text || '').toLowerCase();
  for (const c of src) {
    let shape: Shape | null = null;
    if (c >= 'a' && c <= 'z') shape = SHAPE_OF[c] ?? 'etc';
    else if (/[.,;:!?]/.test(c)) shape = 'rest';
    if (!shape) continue;
    const last = seq[seq.length - 1];
    if (last && last.shape === shape) last.w += HOLD[shape];
    else seq.push({ shape, w: HOLD[shape] });
  }
  if (!seq.length) return [];
  let total = 0;
  for (const s of seq) total += s.w;
  const k = (duration || 1) / total;
  let acc = 0;
  return seq.map((s) => {
    const span = { shape: s.shape, t0: acc, t1: acc + s.w * k };
    acc = span.t1;
    return span;
  });
}

/** Binary search: which shape is the mouth in at time `t`. */
export function shapeAt(seq: Span[], t: number): Shape {
  if (!seq.length || t < seq[0].t0 || t > seq[seq.length - 1].t1) return 'rest';
  let lo = 0, hi = seq.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (seq[m].t1 < t) lo = m + 1; else hi = m; }
  return seq[lo].shape;
}

/* ---------------- driving a face with that timeline ---------------- */

type Rig = Record<Shape, Record<string, number>>;

/**
 * Reallusion's own visemes — shapes that ARE the vowels, sculpted one per mouth
 * position, which is what `colin_head.glb` carries.
 */
const RIG_CC: Rig = {
  rest: {},
  // V_Explosive is the smallest-displacement shape on the mesh: it refines a
  // closure rather than making one, so Mouth_Close does the pressing.
  MBP: { V_Explosive: 1.00, Mouth_Close: 0.60, Mouth_Press_L: 0.40, Mouth_Press_R: 0.40 },
  FV: { V_Dental_Lip: 1.00 },
  E: { V_Wide: 0.88 },
  AI: { V_Open: 0.90, V_Lip_Open: 0.35 },
  O: { V_Tight_O: 0.92 },
  U: { V_Tight_O: 0.55, V_Tight: 0.60 },
  WQ: { V_Tight: 0.95 },
  L: { V_Lip_Open: 0.50, V_Tongue_Raise: 0.70, V_Tongue_Out: 0.20 },
  etc: { V_Affricate: 0.80 },
};

/**
 * Nine shapes sculpted one per mouth position — the set in VISEMES.md, and the
 * one to prefer when a mesh has it.
 *
 * The other two rigs reconstruct a mouth position out of parts: ARKit builds a
 * vowel from a jaw angle plus a pucker plus two stretches, and even Character
 * Creator needs weights per shape that have to be measured against the mesh
 * before they are safe. A purpose-sculpted set needs none of that — the shape IS
 * the position, at weight 1, with nothing to calibrate and nothing to overshoot.
 */
const RIG_SCULPTED: Rig = {
  rest: {},
  MBP: { viseme_MBP: 1 },
  FV: { viseme_FV: 1 },
  E: { viseme_E: 1 },
  AI: { viseme_AI: 1 },
  O: { viseme_O: 1 },
  U: { viseme_U: 1 },
  // WQ is close enough to U that it is not worth a tenth shape to sculpt.
  WQ: { viseme_WQ: 1 },
  L: { viseme_L: 1 },
  etc: { viseme_etc: 1 },
};

/**
 * Apple's 52, for any head that ships those instead. A vowel has to be
 * reconstructed out of a jaw angle plus a pucker plus two stretches, so it is
 * the worse fit — but a driver written against these names works on MetaHuman,
 * Ready Player Me and Apple's own capture without resculpting anything.
 */
const RIG_ARKIT: Rig = {
  rest: {},
  MBP: { mouthClose: 0.92, mouthPressLeft: 0.35, mouthPressRight: 0.35, jawOpen: 0.04 },
  FV: { mouthLowerDownLeft: 0.45, mouthLowerDownRight: 0.45, mouthShrugUpper: 0.30, jawOpen: 0.10 },
  E: { jawOpen: 0.26, mouthStretchLeft: 0.52, mouthStretchRight: 0.52, mouthSmileLeft: 0.18, mouthSmileRight: 0.18 },
  AI: { jawOpen: 0.62, mouthStretchLeft: 0.22, mouthStretchRight: 0.22 },
  O: { jawOpen: 0.44, mouthFunnel: 0.62, mouthPucker: 0.22 },
  U: { jawOpen: 0.18, mouthPucker: 0.68, mouthFunnel: 0.38 },
  WQ: { jawOpen: 0.12, mouthPucker: 0.90, mouthFunnel: 0.30 },
  L: { jawOpen: 0.34, tongueOut: 0.32, mouthStretchLeft: 0.14, mouthStretchRight: 0.14 },
  etc: { jawOpen: 0.22, mouthStretchLeft: 0.20, mouthStretchRight: 0.20 },
};

/** How far the jaw opens for each shape, 0..1 of its own authored range. */
const JAW: Record<Shape, number> = {
  rest: 0.02, MBP: 0, FV: 0.06, E: 0.30, AI: 0.85,
  O: 0.55, U: 0.22, WQ: 0.14, L: 0.45, etc: 0.28,
};

/** Exporters prefix and re-case: CC writes `Mouth_Press_L`, ARKit
 *  `mouthPressLeft`, Blender may write `mouthPressLeft.001`. */
const canon = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '')
  .replace(/left$/, 'l').replace(/right$/, 'r');

/** How far MBP may push the bottom lip up, as a fraction of mouth width.
 *  Measured on the Character Creator base the rig weights were tuned against,
 *  where MBP lifts it 1.07%. */
const LIP_MAX = 0.018;

interface Bound {
  mesh: THREE.SkinnedMesh;
  /** rig shape name → this mesh's influence index. */
  map: Record<string, number>;
  jaw: number | null;
}

export interface Face {
  /** Ease the mouth towards `shape`. Call once per frame. */
  update: (dt: number, shape: Shape) => void;
  /** Which rig was matched, for the console. */
  rig: 'sculpted nine' | 'Character Creator' | 'ARKit';
  jawShape: string | null;
}

/** The biggest vertex displacement in a morph target, in mesh units. */
function reachOf(mesh: THREE.SkinnedMesh, index: number): number {
  const attr = mesh.geometry.morphAttributes?.position?.[index];
  if (!attr) return 0;
  let max = 0;
  for (let v = 0; v < attr.count; v++) {
    const d = Math.hypot(attr.getX(v), attr.getY(v), attr.getZ(v));
    if (d > max) max = d;
  }
  return max;
}

/**
 * The jaw is its own channel, and on this head it is a SHAPE rather than a
 * bone: the armature in the file is a few joints baked in so the graft has
 * landmarks, and the jaw among them carries no skin weight, because the opening
 * was authored as a morph. Picked by reach rather than by name — the file
 * carries both `Jaw_Open` and a custom `jaw_open`, and the custom one moves
 * twice as far.
 */
function findJaw(mesh: THREE.SkinnedMesh): number | null {
  const dict = mesh.morphTargetDictionary;
  if (!dict) return null;
  let best = 0, found: number | null = null;
  for (const name of Object.keys(dict)) {
    if (!/jaw/i.test(name) || /forward|back|up|down|left|right|_l$|_r$/i.test(name)) continue;
    const r = reachOf(mesh, dict[name]);
    if (r > best) { best = r; found = dict[name]; }
  }
  return found;
}

/**
 * A weight in the rig is not a distance.
 *
 * RIG_CC says MBP is V_Explosive at 1.00 plus Mouth_Close at 0.60, and those
 * numbers were chosen by looking at one face. On that face Mouth_Close is a
 * modest press; on this one it is among the largest shapes on the mesh, so the
 * same 0.60 hauls the bottom lip over the top one and the whole mouth reads
 * wrong. So the rig states an intent and the mesh is measured against it: find
 * the mouth, find its bottom half and its width, work out how far MBP lifts it,
 * and take any overshoot out of the single shape doing the most lifting — not
 * out of all of them, or the press that makes an M an M goes too.
 */
function calibrateLips(mesh: THREE.SkinnedMesh, map: Record<string, number>, rig: Rig): Rig {
  const mbp = rig.MBP;
  const pos = mesh.geometry.attributes.position;
  const targets = mesh.geometry.morphAttributes?.position;
  if (!mbp || !pos || !targets?.length) return rig;

  // The mouth is wherever the mapped shapes actually move vertices.
  const reach = new Float32Array(pos.count);
  for (const name in map) {
    const attr = targets[map[name]];
    if (!attr) continue;
    for (let v = 0; v < pos.count; v++) {
      const q = Math.hypot(attr.getX(v), attr.getY(v), attr.getZ(v));
      if (q > reach[v]) reach[v] = q;
    }
  }
  const idx = Array.from(reach.keys()).sort((a, b) => reach[b] - reach[a]).slice(0, 700);
  if (idx.length < 40) return rig;
  let midY = 0;
  for (const v of idx) midY += pos.getY(v);
  midY /= idx.length;
  const lower = idx.filter((v) => pos.getY(v) < midY);
  if (lower.length < 20) return rig;
  let xl = Infinity, xh = -Infinity;
  for (const v of idx) { const x = pos.getX(v); if (x < xl) xl = x; if (x > xh) xh = x; }
  const width = xh - xl;
  if (!(width > 0)) return rig;

  let total = 0, worst: string | null = null, worstRise = 0;
  for (const name in mbp) {
    const i = map[name];
    if (i == null || !targets[i]) continue;
    let sum = 0;
    for (const v of lower) sum += targets[i].getY(v);
    const rise = (sum / lower.length) * mbp[name];
    total += rise;
    if (rise > worstRise) { worstRise = rise; worst = name; }
  }
  const frac = total / width;
  if (frac <= LIP_MAX || !worst || worstRise <= 0) return rig;

  const over = total - LIP_MAX * width;
  const k = Math.max(0, (worstRise - over) / worstRise);
  const tuned = { ...mbp, [worst]: mbp[worst] * k };
  console.log(`visemes: MBP lifted the lip ${(frac * 100).toFixed(2)}% of mouth width; ` +
    `${worst} ${mbp[worst].toFixed(2)} -> ${tuned[worst].toFixed(2)}`);
  return { ...rig, MBP: tuned };
}

/**
 * Bind the timeline to a grafted head. Every mesh with morph targets is driven,
 * since the face is split across primitives.
 */
export function createFace(head: GraftedHead): Face {
  const names = Object.keys(head.morphs);
  const have = names.map(canon);

  // Which vocabulary does this mesh speak? Whichever it has more of.
  const score = (rig: Rig) => {
    const want = new Set<string>();
    for (const sh of Object.keys(rig) as Shape[]) for (const k in rig[sh]) want.add(canon(k));
    let hit = 0;
    for (const w of want) if (have.some((h) => h === w || h.includes(w))) hit++;
    return hit / want.size;
  };
  /* Best fit wins, sculpted first: a mesh that has the purpose-built nine is
     saying exactly what each mouth position should look like, and no amount of
     reconstructing one out of ARKit parts beats being told. */
  const sculpted = score(RIG_SCULPTED);
  let rig = sculpted >= 0.85 ? RIG_SCULPTED
    : score(RIG_CC) >= score(RIG_ARKIT) ? RIG_CC : RIG_ARKIT;
  const which = rig === RIG_SCULPTED ? 'sculpted nine'
    : rig === RIG_CC ? 'Character Creator' : 'ARKit';

  const wanted = new Set<string>();
  for (const sh of Object.keys(rig) as Shape[]) for (const k in rig[sh]) wanted.add(k);

  const bound: Bound[] = [];
  for (const mesh of head.meshes) {
    const dict = mesh.morphTargetDictionary;
    if (!dict || !mesh.morphTargetInfluences) continue;
    const keys = Object.keys(dict);
    const ck = keys.map(canon);
    const map: Record<string, number> = {};
    for (const w of wanted) {
      const cw = canon(w);
      let i = ck.indexOf(cw);
      // Several shapes can contain the name we want: CC ships Mouth_Funnel_Up_L
      // next to plain Mouth_Funnel, and taking the first match drove O and U off
      // a corner variant. Shortest name wins — that is the plain shape.
      if (i < 0) {
        for (let j = 0; j < ck.length; j++) {
          if (ck[j].includes(cw) && (i < 0 || ck[j].length < ck[i].length)) i = j;
        }
      }
      if (i >= 0) map[w] = dict[keys[i]];
    }
    bound.push({ mesh, map, jaw: findJaw(mesh) });
  }

  // Calibrated once, on whichever primitive carries the most mouth — and only
  // where the weights were somebody's guess. A sculpted shape at weight 1 is the
  // artist's own statement of the pose; there is nothing to correct.
  const widest = bound.reduce<Bound | null>((best, b) =>
    (!best || Object.keys(b.map).length > Object.keys(best.map).length ? b : best), null);
  if (widest && rig !== RIG_SCULPTED) rig = calibrateLips(widest.mesh, widest.map, rig);

  const jawName = (() => {
    const b = bound.find((x) => x.jaw != null);
    if (!b || b.jaw == null) return null;
    const dict = b.mesh.morphTargetDictionary!;
    return Object.keys(dict).find((k) => dict[k] === b.jaw) ?? null;
  })();
  console.log(`visemes: ${which} rig, jaw shape ${jawName ?? 'none'}`);

  let jawNow = 0;
  /* Once the mouth has finished closing there is nothing left to ease, and
     writing zeros over the influences every frame would fight anything else that
     wants the face — the test sliders in the tuning panel, for one. So the
     driver hands the face back when it is done with it. */
  let settled = false;

  const update = (dt: number, shape: Shape) => {
    if (shape === 'rest' && settled) return;
    const target = rig[shape] ?? rig.rest;
    // Closing your lips is a movement, not a relaxation. Opening fast and
    // closing slow reads well for a face relaxing and badly for an M: the jaw is
    // still degrees open when the closure is over and the lips never meet. Any
    // commanded shape is reached fast; only the drift back to neutral is lazy.
    const k = 1 - Math.pow(1 - (shape === 'rest' ? 0.28 : 0.50), dt * 60);
    for (const b of bound) {
      const inf = b.mesh.morphTargetInfluences!;
      for (const name in b.map) {
        const i = b.map[name];
        inf[i] += ((target[name] ?? 0) - inf[i]) * k;
      }
    }
    // A sculpted shape already contains its own jaw opening, so the separate
    // jaw channel would open it twice.
    jawNow += ((rig === RIG_SCULPTED ? 0 : JAW[shape] ?? 0) - jawNow) * k;
    // Written last, straight onto the influence: whatever set the mouth shape
    // does not know the jaw is a separate channel, and the jaw has to survive it.
    for (const b of bound) {
      if (b.jaw != null) b.mesh.morphTargetInfluences![b.jaw] = jawNow;
    }

    if (shape !== 'rest') { settled = false; return; }
    /* How far the pose still is from where rest wants it — NOT how far it is
       from zero. The resting jaw is 0.02 rather than 0, because a rest between
       two words is a mouth at ease and not a mouth clamped shut, and measuring
       against zero meant the face never finished arriving and the driver held
       onto it forever. */
    let biggest = Math.abs(jawNow - (rig === RIG_SCULPTED ? 0 : JAW.rest));
    for (const b of bound) {
      const inf = b.mesh.morphTargetInfluences!;
      for (const name in b.map) biggest = Math.max(biggest, Math.abs(inf[b.map[name]] - (rig.rest[name] ?? 0)));
    }
    if (biggest > 1e-3) return;
    // Snapped rather than left a millionth short, so the panel's sliders start clean.
    for (const b of bound) {
      const inf = b.mesh.morphTargetInfluences!;
      for (const name in b.map) inf[b.map[name]] = rig.rest[name] ?? 0;
      if (b.jaw != null) inf[b.jaw] = rig === RIG_SCULPTED ? 0 : JAW.rest;
    }
    jawNow = rig === RIG_SCULPTED ? 0 : JAW.rest;
    settled = true;
  };

  return { update, rig: which, jawShape: jawName };
}
