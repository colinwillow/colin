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

/** Warm when he talks, cool when you do, and grey when neither. Chosen to read
 *  on a white sweep, which is what he now stands on by default. */
const COLOURS: Record<WaveMode, Palette> = {
  idle: { lines: ['rgba(120,112,103,0.40)', 'rgba(120,112,103,0.30)', 'rgba(120,112,103,0.22)'], glow: 'rgba(0,0,0,0)' },
  listening: { lines: ['#1d7fa6', '#2fb3c4', '#6fe0cf'], glow: 'rgba(47,179,196,0.55)' },
  speaking: { lines: ['#c2762e', '#e0a04a', '#f2cd7c'], glow: 'rgba(224,160,74,0.55)' },
};

export interface WaveSources {
  voice: { readonly speaking: boolean; readonly analyser: AnalyserNode | null };
  mic?: { readonly on: boolean; readonly analyser: AnalyserNode | null };
}

export interface Wave {
  update: (dt: number) => void;
  meter: Meter;
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

/** How each line behaves. Low and slow at the bottom, quick and thin on top. */
const SHAPE = [
  { cycles: 1.5, speed: 0.55, weight: 2.4, reach: 1.0 },
  { cycles: 2.6, speed: 0.95, weight: 1.7, reach: 0.82 },
  { cycles: 4.1, speed: 1.55, weight: 1.2, reach: 0.64 },
];

export function createWave(canvas: HTMLCanvasElement, sources: WaveSources): Wave {
  const ctx = canvas.getContext('2d');
  const meter: Meter = { mode: 'idle', energy: 0 };

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

    const palette = COLOURS[mode];
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
      ctx.shadowBlur = (mode === 'idle' ? 0 : 7 + shownLevel * 9) * dpr;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  };

  return { update, meter, heard: () => { meter.energy = Math.min(1, meter.energy + 0.5); } };
}
