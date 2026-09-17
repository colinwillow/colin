// Your voice, as actual audio.
//
// This used to be the one thing the meter faked. Speech recognition and an audio
// stream are two separate grants, so drawing your real waveform meant a second
// permission prompt — and being asked twice to get a decoration was a bad trade
// while the decoration was a sine wave.
//
// It is not a decoration any more. The meter is the only thing on screen while
// you are talking to him, so it has to be the real signal: what you are actually
// saying, in the shape you actually said it.
//
// TWO THINGS MAKE THIS BEHAVE.
//
//   It shares the voice's AudioContext. A page gets a small number of them and
//   iOS suspends them on a whim; two running at once is how you end up with
//   neither. The microphone hangs off the context the voice already built.
//
//   It is never connected to the speakers. The source goes to an analyser and
//   stops there. Wiring a live microphone to the output is a feedback loop with
//   a face.
//
// The stream stays open once it has been opened. Stopping the tracks turns the
// browser's recording indicator off, which sounds polite until you notice that
// re-opening it flashes a permission chip on every single exchange.

export interface Mic {
  /** Ask for the microphone. From a user gesture, and once per page. */
  open: (context: AudioContext) => Promise<boolean>;
  /** True once the stream is live. */
  readonly on: boolean;
  /** Whether the person said no, so nothing asks again. */
  readonly refused: boolean;
  /** 0–1, how loud you are right now. Smoothed, with a noise floor. */
  readonly level: number;
  /** Per frame, before anything reads `level`. */
  update: () => void;
  /** Fill `into` with the spectrum, 0–255 per bin. False when there is no mic. */
  spectrum: (into: Uint8Array<ArrayBuffer>) => boolean;
  /** Fill `into` with the waveform, -1..1. */
  waveform: (into: Float32Array) => boolean;
  /** Let go of the microphone entirely — the indicator goes out. */
  close: () => void;
}

/**
 * Where the noise floor sits, in dBFS.
 *
 * A room is never silent and a phone microphone has its own hiss, so a meter
 * keyed to raw RMS sits permanently a third of the way up and twitches at the
 * fridge. Everything below this reads as nothing; the useful range of a voice at
 * arm's length is the 34 dB above it.
 */
const FLOOR_DB = -58;
const RANGE_DB = 34;

export function createMic(): Mic {
  let stream: MediaStream | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let time: Float32Array<ArrayBuffer> | null = null;
  let level = 0;
  let refused = false;

  const open = async (context: AudioContext) => {
    if (analyser) return true;
    if (refused || !navigator.mediaDevices?.getUserMedia) return false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          /* The browser's own cleanup, all three of them. This is a voice at
             arm's length in a kitchen, not a recording session: echo
             cancellation is what stops HIS voice coming back in through the
             microphone and drawing itself. */
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      // Denied, or no device. Either way this asks once and never again.
      refused = true;
      return false;
    }
    analyser = context.createAnalyser();
    /* Smaller than the voice's: this is drawn, not lip-synced, and 1024 samples
       at 48 kHz is a 21 ms window — short enough to move with the syllables. */
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.72;
    source = context.createMediaStreamSource(stream);
    // Into the analyser and NOWHERE ELSE. No connection to the destination.
    source.connect(analyser);
    time = new Float32Array(analyser.fftSize);
    return true;
  };

  const update = () => {
    if (!analyser || !time) { level *= 0.9; return; }
    analyser.getFloatTimeDomainData(time);
    let sum = 0;
    for (let i = 0; i < time.length; i++) sum += time[i] * time[i];
    const rms = Math.sqrt(sum / time.length);
    const db = 20 * Math.log10(rms + 1e-7);
    const want = Math.min(1, Math.max(0, (db - FLOOR_DB) / RANGE_DB));
    // Fast up, slow down: a meter that falls as quickly as it rises flickers on
    // every consonant and reads as a fault rather than as a voice.
    level += (want - level) * (want > level ? 0.45 : 0.1);
  };

  return {
    open,
    get on() { return analyser !== null; },
    get refused() { return refused; },
    get level() { return level; },
    update,
    spectrum: (into) => {
      if (!analyser) return false;
      analyser.getByteFrequencyData(into);
      return true;
    },
    waveform: (into) => {
      if (!analyser || !time) return false;
      analyser.getFloatTimeDomainData(time);
      const step = time.length / into.length;
      for (let i = 0; i < into.length; i++) into[i] = time[Math.floor(i * step)];
      return true;
    },
    close: () => {
      for (const track of stream?.getTracks() ?? []) track.stop();
      source?.disconnect();
      stream = null;
      source = null;
      analyser = null;
      time = null;
      level = 0;
    },
  };
}
