// The meter: the only thing on screen while the two of you are talking, so it
// has to be worth looking at and it has to be true.
//
// BOTH HALVES ARE REAL NOW. His comes off the analyser the voice already has on
// the way to the speakers; yours comes off `src/mic.ts`, which is a second
// permission and worth it — a sine wave pretending to be your voice is fine as a
// placeholder and obvious the moment you look at it. When there is no microphone
// (denied, or a browser without one) it falls back to the old behaviour: the
// recogniser pushes the level up as words arrive.
//
// It draws a SPECTRUM rather than a waveform, and that is the difference between
// looking alive and looking like an oscilloscope. A time-domain trace of speech
// at this size is a fuzzy band — every frame is a different random squiggle of
// about the same height. The frequency domain moves the way a voice does:
// vowels sit low and wide, consonants flick the top end, and the shape changes
// with what is being said rather than with where the buffer happened to start.
//
// The bars are spaced LOGARITHMICALLY, because the linear bins the FFT hands
// back put everything anyone says in the leftmost eighth of them. An octave is
// an octave wide here, so a voice fills the whole meter.
import * as THREE from 'three';

export type WaveMode = 'idle' | 'listening' | 'speaking';

export interface Meter {
  mode: WaveMode;
  /** Pushed up when words arrive; decays on its own. The stand-in for a real
   *  level when the microphone was refused. */
  energy: number;
}

interface Palette {
  /** The bars, left to right. Two stops, so the meter has a direction. */
  from: string;
  to: string;
  /** How much light it throws. */
  glow: number;
}

/** Warm when he talks, cool when you do, and barely there when neither. */
const COLOURS: Record<WaveMode, Palette> = {
  idle: { from: 'rgba(150, 141, 130, 0.5)', to: 'rgba(150, 141, 130, 0.5)', glow: 0 },
  listening: { from: '#4aa8c8', to: '#7ee0d0', glow: 10 },
  speaking: { from: '#e0a86a', to: '#f0d08a', glow: 12 },
};

export interface WaveSources {
  voice: {
    readonly speaking: boolean;
    readonly level: number;
    spectrum: (into: Uint8Array<ArrayBuffer>) => boolean;
    readonly context: AudioContext | null;
  };
  mic?: {
    readonly on: boolean;
    readonly level: number;
    spectrum: (into: Uint8Array<ArrayBuffer>) => boolean;
  };
}

export interface Wave {
  update: (dt: number) => void;
  meter: Meter;
  /** Call when the recogniser hears something. Only does anything when there is
   *  no microphone to read instead. */
  heard: () => void;
}

/** How many bars. Enough to read as a spectrum, few enough to stay chunky on a
 *  phone — at 64 they are hairlines and the whole thing turns into a smear. */
const BARS = 34;
/** The band a voice actually occupies. Below 90 Hz is room rumble and above
 *  6 kHz is sibilance and hiss; between them is everything anyone says. */
const LOW_HZ = 90;
const HIGH_HZ = 6200;

export function createWave(canvas: HTMLCanvasElement, sources: WaveSources): Wave {
  const ctx = canvas.getContext('2d');
  const meter: Meter = { mode: 'idle', energy: 0 };

  const bins = new Uint8Array(2048);
  const bars = new Float32Array(BARS);
  /** What is drawn, eased toward what is wanted, so nothing ever snaps. */
  const shown = new Float32Array(BARS);
  let phase = 0;

  const fit = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 240;
    const h = canvas.clientHeight || 34;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  };

  /**
   * FFT bins → bars, log-spaced, with the top end lifted.
   *
   * Speech falls off steeply with frequency — the energy in an "s" is a fraction
   * of the energy in an "ah" — so a meter drawn straight off the magnitudes is
   * a hill on the left and nothing else. The tilt is the same one every audio
   * meter applies, and it is what makes consonants visible at all.
   */
  const fold = (read: (into: Uint8Array<ArrayBuffer>) => boolean, binCount: number, nyquist: number) => {
    if (!read(bins)) return false;
    const usable = Math.min(binCount, bins.length);
    for (let i = 0; i < BARS; i++) {
      const lo = LOW_HZ * Math.pow(HIGH_HZ / LOW_HZ, i / BARS);
      const hi = LOW_HZ * Math.pow(HIGH_HZ / LOW_HZ, (i + 1) / BARS);
      const from = Math.max(0, Math.min(usable - 1, Math.floor((lo / nyquist) * usable)));
      const to = Math.max(from + 1, Math.min(usable, Math.ceil((hi / nyquist) * usable)));
      let peak = 0;
      // The peak rather than the mean: an average across a wide high band is
      // always small, and the thing worth drawing is the loudest thing in it.
      for (let b = from; b < to; b++) peak = Math.max(peak, bins[b]);
      const tilt = 1 + (i / BARS) * 1.25;
      bars[i] = Math.min(1, (peak / 255) * tilt);
    }
    return true;
  };

  const update = (dt: number) => {
    if (!ctx) return;
    fit();
    const { width: w, height: h } = canvas;
    const mid = h / 2;

    meter.energy = Math.max(0, meter.energy - dt * 1.6);
    const mode: WaveMode = sources.voice.speaking ? 'speaking' : meter.mode;

    const rate = sources.voice.context?.sampleRate ?? 48000;
    let real = false;
    if (mode === 'speaking') real = fold(sources.voice.spectrum, 1024, rate / 2);
    else if (mode === 'listening' && sources.mic?.on) real = fold(sources.mic.spectrum, 512, rate / 2);

    if (!real) {
      /* No microphone, or nothing playing. Three sines that do not share a
         period, so it never visibly repeats, scaled by whatever the recogniser
         has told us — it tracks WHETHER you are talking, not what it sounds
         like, and it should look like the guess it is. */
      phase += dt * (mode === 'listening' ? 5.2 : 1.1);
      const amp = mode === 'listening' ? 0.2 + meter.energy * 0.65 : 0.05;
      for (let i = 0; i < BARS; i++) {
        const x = (i / BARS) * Math.PI * 2;
        bars[i] = Math.abs(amp * (
          Math.sin(x * 3 + phase) * 0.5
          + Math.sin(x * 5.3 - phase * 0.7) * 0.3
          + Math.sin(x * 8.1 + phase * 1.3) * 0.2));
      }
    }

    // Arched, always: the ends are shorter than the middle whatever the signal
    // is doing, which is what stops it reading as a bar chart. The FLOOR is
    // arched too — a uniform minimum turns silence into a row of identical dots,
    // and a lens-shaped one still reads as a meter waiting for something.
    for (let i = 0; i < BARS; i++) {
      const arch = 0.45 + 0.55 * Math.sin((i / (BARS - 1)) * Math.PI);
      const want = Math.max(0.03 + 0.08 * arch, bars[i] * arch);
      // Fast attack, slow release — the same asymmetry every meter has, and the
      // reason a peak stays long enough to be seen.
      const k = 1 - Math.pow(want > shown[i] ? 0.00005 : 0.02, dt);
      shown[i] += (want - shown[i]) * k;
    }

    const palette = COLOURS[mode];
    ctx.clearRect(0, 0, w, h);

    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, palette.from);
    gradient.addColorStop(1, palette.to);
    ctx.fillStyle = gradient;
    ctx.shadowColor = palette.to;
    ctx.shadowBlur = palette.glow * (canvas.width / (canvas.clientWidth || 240));

    const gap = w / BARS;
    const width = Math.max(2, gap * 0.52);
    const radius = width / 2;
    for (let i = 0; i < BARS; i++) {
      const x = gap * (i + 0.5) - width / 2;
      // Mirrored about the centre line, and never shorter than a dot: a bar that
      // goes to nothing leaves a gap in the row and reads as a dead pixel.
      const half = Math.max(radius, THREE.MathUtils.clamp(shown[i], 0, 1) * mid * 0.92);
      ctx.beginPath();
      ctx.roundRect(x, mid - half, width, half * 2, radius);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  };

  return { update, meter, heard: () => { meter.energy = Math.min(1, meter.energy + 0.5); } };
}
