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
import { canonicalShapeName, type FaceRig } from './face';

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
 * Character Creator's own visemes — shapes that ARE the vowels, sculpted one per
 * mouth position, which is what `colin.glb` carries (as `V_Open_MIX` and so on;
 * the export's `MIX` suffix is stripped when names are matched).
 *
 * No tongue in this export, so L is the lip shape and the jaw alone. It reads
 * fine — the tongue only shows on a wide open L and there is not one to show.
 */
const RIG_CC: Rig = {
  rest: {},
  // V_Explosive is the smallest-displacement shape on the mesh: it refines a
  // closure rather than making one, so Mouth_Close does the pressing.
  MBP: { V_Explosive: 1.00, Mouth_Close: 0.55, Mouth_Press_L: 0.35, Mouth_Press_R: 0.35 },
  FV: { V_Dental_Lip: 1.00 },
  E: { V_Wide: 0.88 },
  AI: { V_Open: 0.90, V_Lip_Open: 0.35 },
  O: { V_Tight_O: 0.92, Mouth_Funnel: 0.25 },
  U: { V_Tight_O: 0.55, V_Tight: 0.60, Mouth_Pucker: 0.25 },
  WQ: { V_Tight: 0.95, Mouth_Pucker: 0.35 },
  L: { V_Lip_Open: 0.60 },
  etc: { V_Affricate: 0.80 },
};

/** Nine shapes sculpted one per mouth position — preferred when a mesh has
 *  them, since the shape IS the position at weight 1 with nothing to mix. */
const RIG_SCULPTED: Rig = {
  rest: {},
  MBP: { viseme_MBP: 1 }, FV: { viseme_FV: 1 }, E: { viseme_E: 1 },
  AI: { viseme_AI: 1 }, O: { viseme_O: 1 }, U: { viseme_U: 1 },
  WQ: { viseme_WQ: 1 }, L: { viseme_L: 1 }, etc: { viseme_etc: 1 },
};

/** Apple's 52, for any head that ships those instead. */
const RIG_ARKIT: Rig = {
  rest: {},
  MBP: { mouthClose: 0.92, mouthPressLeft: 0.35, mouthPressRight: 0.35 },
  FV: { mouthLowerDownLeft: 0.45, mouthLowerDownRight: 0.45, mouthShrugUpper: 0.30 },
  E: { mouthStretchLeft: 0.52, mouthStretchRight: 0.52, mouthSmileLeft: 0.18, mouthSmileRight: 0.18 },
  AI: { mouthStretchLeft: 0.22, mouthStretchRight: 0.22 },
  O: { mouthFunnel: 0.62, mouthPucker: 0.22 },
  U: { mouthPucker: 0.68, mouthFunnel: 0.38 },
  WQ: { mouthPucker: 0.90, mouthFunnel: 0.30 },
  L: { tongueOut: 0.32, mouthStretchLeft: 0.14, mouthStretchRight: 0.14 },
  etc: { mouthStretchLeft: 0.20, mouthStretchRight: 0.20 },
};

/**
 * How far the jaw opens for each shape, 0–1 of its authored range.
 *
 * This drives `Jaw_Open`, and on this model that one name reaches BOTH the head
 * and the teeth — the teeth mesh's only shape is called `Jaw_Open` too, so they
 * open together for free. That is what stops his teeth staying shut through an
 * O or a pucker, where the lips part but nothing behind them does.
 */
const JAW: Record<Shape, number> = {
  rest: 0.02, MBP: 0, FV: 0.06, E: 0.30, AI: 0.85,
  O: 0.55, U: 0.22, WQ: 0.14, L: 0.45, etc: 0.28,
};

export interface Mouth {
  /** Ease the mouth towards `shape`. Call once per frame, before `commit`. */
  update: (dt: number, shape: Shape) => void;
  /** Which vocabulary was matched, for the console. */
  rig: 'sculpted nine' | 'Character Creator' | 'ARKit';
  /** How many of the rig's shapes the mesh actually has. */
  matched: string[];
  missing: string[];
}

/**
 * Bind the timeline to a face.
 *
 * Unlike the old grafted head, nothing here writes influences: it asks the rig
 * for what it wants and the rig composites. A blink and a viseme are both
 * opinions about the same face, and the compositor is what keeps them from
 * cancelling each other out.
 */
export function createMouth(face: FaceRig): Mouth {
  const have = new Set(face.names.map(canonicalShapeName));
  const score = (rig: Rig) => {
    const want = new Set<string>();
    for (const sh of Object.keys(rig) as Shape[]) for (const k in rig[sh]) want.add(canonicalShapeName(k));
    let hit = 0;
    for (const w of want) if (have.has(w)) hit++;
    return hit / want.size;
  };
  const sculpted = score(RIG_SCULPTED);
  const rig = sculpted >= 0.85 ? RIG_SCULPTED
    : score(RIG_CC) >= score(RIG_ARKIT) ? RIG_CC : RIG_ARKIT;
  const which = rig === RIG_SCULPTED ? 'sculpted nine'
    : rig === RIG_CC ? 'Character Creator' : 'ARKit';

  const wanted = new Set<string>();
  for (const sh of Object.keys(rig) as Shape[]) for (const k in rig[sh]) wanted.add(k);
  const matched = [...wanted].filter((w) => have.has(canonicalShapeName(w)));
  const missing = [...wanted].filter((w) => !have.has(canonicalShapeName(w)));

  /** Where each shape currently sits, so it can be eased rather than snapped. */
  const now = new Map<string, number>();
  for (const w of wanted) now.set(w, 0);
  let jawNow = 0;

  const update = (dt: number, shape: Shape) => {
    const target = rig[shape] ?? rig.rest;
    /* Closing your lips is a movement, not a relaxation. Opening fast and
       closing slow reads well for a face relaxing and badly for an M: the jaw is
       still degrees open when the closure is over and the lips never meet. Any
       commanded shape is reached fast; only the drift back to neutral is lazy. */
    const k = 1 - Math.pow(1 - (shape === 'rest' ? 0.28 : 0.50), dt * 60);
    for (const name of wanted) {
      const next = (now.get(name) ?? 0) + ((target[name] ?? 0) - (now.get(name) ?? 0)) * k;
      now.set(name, next);
      if (next > 0.001) face.want(name, next);
    }
    jawNow += ((JAW[shape] ?? 0) - jawNow) * k;
    if (jawNow > 0.001) face.want('Jaw_Open', jawNow);
  };

  return { update, rig: which, matched, missing };
}
