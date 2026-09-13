// The level meter along the bottom: something to look at while the two of you
// take turns.
//
// HIS half is real. The voice already has an analyser on the way to the
// speakers, so those are actual samples of actual audio.
//
// YOURS is not, and that is a deliberate trade rather than a shortcut. Drawing
// your real waveform means `getUserMedia`, and speech recognition is a separate
// grant from an audio stream — the browser asks twice, and being asked for the
// microphone twice to get a decoration is a bad deal. So while you talk, this is
// driven by the recogniser instead: words arriving push it up, silence lets it
// fall. It tracks whether you are talking, not what it sounds like.
import * as THREE from 'three';

export type WaveMode = 'idle' | 'listening' | 'speaking';

export interface Meter {
  mode: WaveMode;
  /** Pushed up when words arrive; decays on its own. */
  energy: number;
}

/** Warm when he talks, cool when you do, and barely there when neither. */
const COLOURS: Record<WaveMode, string> = {
  idle: 'rgba(138, 129, 120, 0.45)',
  listening: 'rgba(126, 186, 200, 0.95)',
  speaking: 'rgba(200, 160, 106, 0.95)',
};

export interface Wave {
  update: (dt: number) => void;
  meter: Meter;
  /** Call when the recogniser hears something, to kick the listening level. */
  heard: () => void;
}

export function createWave(
  canvas: HTMLCanvasElement,
  voice: { waveform: (into: Float32Array) => boolean; readonly level: number; readonly speaking: boolean },
): Wave {
  const ctx = canvas.getContext('2d');
  const meter: Meter = { mode: 'idle', energy: 0 };
  const N = 96;
  const samples = new Float32Array(N);
  /** What is drawn, eased toward what is wanted, so the line never snaps. */
  const shown = new Float32Array(N);
  let phase = 0;
  let colour = COLOURS.idle;

  /* Resolution follows the element, so it is crisp on a phone without being
     redrawn at four times the size it is shown at. */
  const fit = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 230;
    const h = canvas.clientHeight || 22;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  };

  const update = (dt: number) => {
    if (!ctx) return;
    fit();
    const { width: w, height: h } = canvas;
    const mid = h / 2;

    meter.energy = Math.max(0, meter.energy - dt * 1.6);
    const mode: WaveMode = voice.speaking ? 'speaking' : meter.mode;

    let real = false;
    if (mode === 'speaking') real = voice.waveform(samples);
    if (!real) {
      /* A travelling wave rather than noise: three sines that do not share a
         period, so it never visibly repeats. Amplitude is the level, so an idle
         line is nearly flat and a listening one moves. */
      phase += dt * (mode === 'listening' ? 5.2 : 1.5);
      const amp = mode === 'listening' ? 0.22 + meter.energy * 0.7 : 0.045;
      for (let i = 0; i < N; i++) {
        const x = (i / N) * Math.PI * 2;
        samples[i] = amp * (
          Math.sin(x * 3 + phase) * 0.5
          + Math.sin(x * 5.3 - phase * 0.7) * 0.3
          + Math.sin(x * 8.1 + phase * 1.3) * 0.2);
        // Pinned at both ends, so it reads as a held string rather than a strip.
        samples[i] *= Math.sin((i / (N - 1)) * Math.PI);
      }
    }

    const k = 1 - Math.pow(0.002, dt);
    for (let i = 0; i < N; i++) shown[i] += (samples[i] - shown[i]) * k;

    const want = COLOURS[mode];
    colour = want;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = Math.max(1.5, h * 0.07);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = colour;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * w;
      const y = mid - THREE.MathUtils.clamp(shown[i], -1, 1) * mid * 0.86;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  return { update, meter, heard: () => { meter.energy = Math.min(1, meter.energy + 0.5); } };
}
