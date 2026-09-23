// The meter: three lines that come apart when somebody talks.
//
// The old one was a row of bars, and a row of bars is a level display — it goes
// up and down and that is all it can say. This is three travelling waves, one
// per third of the spectrum, and each of them is doing four things at once:
//
//   its AMPLITUDE is that third's energy
//   its SHAPE is the eight sub-bands inside that third, so it deforms with the
//     actual sound rather than sliding past as a rigid sine
//   its PITCH tightens with the spectral centroid — bright sounds wiggle faster
//   its SPEED kicks on spectral flux, so consonants and plosives land
//
// The bottom line is the chest of a voice, the middle its body, the top its
// consonants; they sit on top of each other at rest and separate the moment
// anything happens. That separation is the whole effect — a single line can only
// be louder or quieter, and three can disagree.
//
// All of the numbers come from `audio.ts`, which is where the moving noise floor
// is, and that is the part that actually made this reactive. Everything below is
// drawing.
import { createFeatureReader, type Features } from './audio';
import { atLightness, isWarm, type Swatch } from './palette';

export type WaveMode = 'idle' | 'listening' | 'speaking';

export interface Meter {
  mode: WaveMode;
  /** Pushed up when words arrive; decays on its own. The stand-in for a real
   *  level when the microphone was refused. */
  energy: number;
}

interface Palette {
  /** Bottom line to top line. Darkest and heaviest first. */
  lines: [string, string, string];
  glow: string;
}

/** Where the three lines sit on the value scale, dark to light.
 *
 *  THE LADDER IS THE LEGIBILITY AND THE HUES ARE THE DECORATION. The darkest
 *  line survives anything pale, the lightest survives anything dark, and the
 *  middle one is held well clear of the beige backdrop — a line the same value
 *  as what is behind it is not a line. Sampling his jacket changes what colour
 *  each of the three is, never where it sits. */
const LADDER = [0.2, 0.44, 0.88];
/** A CEILING, not a target, and the difference is the whole character of the
 *  thing. Forcing the sampled hues UP to a fixed saturation turned a muted
 *  jacket mauve into bubblegum: the colours on that coat are dusty, and a
 *  palette taken off it should be dusty too. Each line keeps its swatch's own
 *  saturation unless that is higher than the rung allows. The lightest is capped
 *  hardest because a saturated colour at that value is a pastel, and a pastel on
 *  a beige sweep is nothing at all. */
const SATURATION_CAP = [0.5, 0.42, 0.26];
/** And a floor, or a nearly-grey swatch gives a nearly-grey line. */
const MIN_SATURATION = 0.16;

/**
 * Ink, beige and cream — the same three the interface is built from.
 *
 * THREE COLOURS THAT COVER EVERY BACKDROP, which is the practical reason as much
 * as the aesthetic one: the ink line survives anything pale, the cream one
 * survives anything dark, and the beige sits between them. There is no backdrop
 * in the table that can hide all three.
 *
 * Whose turn it is comes through as temperature rather than as a different hue.
 * Yours is neutral — near-black, stone, chalk. His is warm — a deep brown, an
 * ochre and a warm white — so the row shifts perceptibly without either of them
 * leaving the palette. The middle line of each is darker than it looks like it
 * should be, because "beige" and "the beige backdrop" are the same value and a
 * line the colour of what is behind it is not a line. The glow is a PAPER-coloured halo rather than a coloured
 * one: it is there so a dark line stays legible where it crosses him, not to
 * make the thing look lit.
 */
const COLOURS: Record<WaveMode, Palette> = {
  idle: { lines: ['rgba(30,24,17,0.34)', 'rgba(30,24,17,0.24)', 'rgba(30,24,17,0.16)'], glow: 'rgba(0,0,0,0)' },
  listening: { lines: ['#1e1811', '#6a5d4c', '#fbf7ee'], glow: 'rgba(250,245,234,0.85)' },
  speaking: { lines: ['#3a2612', '#8d6835', '#fff8e9'], glow: 'rgba(255,248,233,0.85)' },
};

export interface WaveSources {
  voice: { readonly speaking: boolean; readonly analyser: AnalyserNode | null };
  mic?: { readonly on: boolean; readonly analyser: AnalyserNode | null };
}

export interface Wave {
  update: (dt: number) => void;
  meter: Meter;
  /** Repaint from colours sampled off his clothes. Anything it cannot fill in
   *  keeps the ink-and-cream default. */
  setPalette: (swatches: Swatch[]) => void;
  /** Call when the recogniser hears something. Only does anything when there is
   *  no microphone to read instead. */
  heard: () => void;
}

/** Eight sub-bands per line, three lines. The eight are what makes a line
 *  deform along its length instead of just getting taller. */
const PER_LINE = 8;
const LINES = 3;
const BANDS = LINES * PER_LINE;
/** Points along each line. Enough to curve smoothly, few enough to be free. */
const STEPS = 72;
const TAU = Math.PI * 2;

/** How each line behaves. Low and slow at the bottom, quick and thin on top.
 *  The weights are pen widths rather than highlighter widths: the look being
 *  aimed at is drawn, and a 2.4px line with a coloured glow behind it is neon. */
const SHAPE = [
  { cycles: 1.5, speed: 0.55, weight: 1.9, reach: 1.0 },
  { cycles: 2.6, speed: 0.95, weight: 1.35, reach: 0.82 },
  { cycles: 4.1, speed: 1.55, weight: 1.0, reach: 0.64 },
];

export function createWave(canvas: HTMLCanvasElement, sources: WaveSources): Wave {
  const ctx = canvas.getContext('2d');
  const meter: Meter = { mode: 'idle', energy: 0 };
  /** Repainted by `setPalette`; the defaults above until then. */
  const colours: Record<WaveMode, Palette> = {
    idle: { ...COLOURS.idle },
    listening: { ...COLOURS.listening },
    speaking: { ...COLOURS.speaking },
  };

  const mine = createFeatureReader(BANDS);
  const his = createFeatureReader(BANDS);

  /** Phase per line, advanced at its own rate so they never lock together. */
  const phase = [0, 2.1, 4.3];
  /** What is drawn, eased toward what the analyser says. */
  const shown = new Float32Array(BANDS);
  let shownLevel = 0;
  let shownCentroid = 0;
  let shownImpulse = 0;

  const fit = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 260;
    const h = canvas.clientHeight || 56;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  };

  /** The eight sub-bands of one line, sampled smoothly at t. */
  const detailAt = (line: number, t: number) => {
    const x = t * (PER_LINE - 1);
    const i = Math.min(PER_LINE - 2, Math.floor(x));
    const f = x - i;
    const a = shown[line * PER_LINE + i];
    const b = shown[line * PER_LINE + i + 1];
    // Smoothstep between neighbours: linear interpolation puts a visible corner
    // at every sub-band boundary, which reads as eight segments rather than one
    // line that happens to be deforming.
    return a + (b - a) * (f * f * (3 - 2 * f));
  };

  const update = (dt: number) => {
    if (!ctx) return;
    fit();
    const { width: w, height: h } = canvas;
    const mid = h / 2;

    meter.energy = Math.max(0, meter.energy - dt * 1.6);
    const mode: WaveMode = sources.voice.speaking ? 'speaking' : meter.mode;

    /* Both are read every frame regardless of whose turn it is. An analyser that
       is not being drawn still has to keep its history moving, or the moving
       noise floor restarts from nothing every time the turn changes and the
       first second of every sentence is wrong. */
    his.read(sources.voice.analyser);
    mine.read(sources.mic?.on ? sources.mic.analyser : null);

    const from: Features = mode === 'speaking' ? his.features : mine.features;
    const real = mode !== 'idle' && from.live;

    if (real) {
      for (let i = 0; i < BANDS; i++) shown[i] += (from.bands[i] - shown[i]) * (1 - Math.pow(0.02, dt));
      shownLevel += (from.level - shownLevel) * (1 - Math.pow(0.01, dt));
      shownCentroid += (from.centroid - shownCentroid) * (1 - Math.pow(0.1, dt));
      shownImpulse = Math.max(shownImpulse * Math.pow(0.02, dt), from.impulse);
    } else {
      /* No microphone, or nothing to listen to. The recogniser's word-by-word
         energy is all there is, so the lines breathe at a level rather than
         pretending to have a spectrum: every band gets the same number and the
         carriers do the rest. It should look like the guess it is. */
      const guess = mode === 'listening' ? 0.12 + meter.energy * 0.5 : 0.05;
      for (let i = 0; i < BANDS; i++) shown[i] += (guess - shown[i]) * (1 - Math.pow(0.15, dt));
      shownLevel += (guess - shownLevel) * (1 - Math.pow(0.1, dt));
      shownCentroid += (0.3 - shownCentroid) * (1 - Math.pow(0.3, dt));
      shownImpulse *= Math.pow(0.1, dt);
    }

    const palette = colours[mode];
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = palette.glow;

    const dpr = canvas.width / (canvas.clientWidth || 260);

    for (let line = 0; line < LINES; line++) {
      const shape = SHAPE[line];
      // Brighter sounds wiggle tighter; a kick briefly speeds everything up.
      const cycles = shape.cycles * (0.8 + shownCentroid * 0.7);
      phase[line] += dt * shape.speed * TAU * (0.35 + shownLevel * 1.5 + shownImpulse * 1.2);

      let amp = 0;
      for (let i = 0; i < PER_LINE; i++) amp += shown[line * PER_LINE + i];
      amp /= PER_LINE;
      amp = Math.min(1, amp * 1.35 + shownLevel * 0.35);

      /* Held apart at rest and allowed to collapse together when it gets loud.
         Three lines with nothing to say sit on exactly the same path and read as
         one thick line — which is what this looked like before — so they are
         spread while it is quiet, and the spread closes as the amplitude that
         makes them distinguishable takes over. */
      const spread = (line - 1) * mid * 0.17 * (1 - Math.min(1, shownLevel * 1.4));

      ctx.beginPath();
      for (let s = 0; s <= STEPS; s++) {
        const t = s / STEPS;
        // Pinned at both ends: a line that reaches the edge at full height reads
        // as a strip of something, not as a string being plucked.
        const window_ = Math.sin(t * Math.PI);
        const detail = detailAt(line, t);
        const carrier =
          Math.sin(TAU * cycles * t + phase[line]) * 0.62
          + Math.sin(TAU * cycles * 1.73 * t - phase[line] * 0.61) * 0.38;
        /* A tenth of the height even in silence, so the lines are always doing
           something, and most of it available to a voice — clamped, because a
           line that reaches the edge of the canvas is a line with its peaks
           sliced off, and a flat top is the one shape a waveform must not have. */
        const swing = Math.min(1, 0.1 + amp * 0.8 + detail * 0.5);
        const y = mid + spread - carrier * window_ * swing * mid * 0.86 * shape.reach;
        const x = t * w;
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = palette.lines[line];
      ctx.lineWidth = shape.weight * dpr;
      // Small and paper-coloured: enough to keep a dark line off a dark jacket,
      // not enough to read as a light source.
      ctx.shadowBlur = (mode === 'idle' ? 0 : 4) * dpr;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  };

  /**
   * Take the hues off his clothes.
   *
   * His jacket has both halves of the wheel in it, so the two speakers can each
   * have their own without either leaving the garment: the warm side — the rust
   * and the ochre — is him talking, and the cool side is you. Which is not only
   * pretty. It is the same trick the default palette used, where his turn was
   * warm and yours was neutral, done with colours that are actually in the room.
   */
  const setPalette = (swatches: Swatch[]) => {
    if (!swatches.length) return;
    const warm = swatches.filter((s) => isWarm(s.hue));
    const cool = swatches.filter((s) => !isWarm(s.hue));

    const three = (from: Swatch[], fallback: Swatch[]) => {
      const pool = from.length ? from : fallback;
      if (!pool.length) return null;
      // Fewer than three distinct hues is normal — a coat can be two colours —
      // so the pool cycles rather than the palette going short.
      return LADDER.map((l, i) => {
        const swatch = pool[i % pool.length];
        const saturation = Math.min(SATURATION_CAP[i], Math.max(MIN_SATURATION, swatch.saturation));
        return atLightness(swatch, l, saturation);
      }) as [string, string, string];
    };

    const hot = three(warm, cool);
    const cold = three(cool, warm);
    if (hot) colours.speaking = { lines: hot, glow: COLOURS.speaking.glow };
    if (cold) colours.listening = { lines: cold, glow: COLOURS.listening.glow };
    console.log(`meter — his ${hot?.join(' ') ?? '(default)'} · yours ${cold?.join(' ') ?? '(default)'}`);
  };

  return {
    update,
    meter,
    setPalette,
    heard: () => { meter.energy = Math.min(1, meter.energy + 0.5); },
  };
}
