// Your voice, as actual audio.
//
// This used to be the one thing the meter faked. Speech recognition and an audio
// stream are two separate grants, so drawing your real waveform meant a second
// permission prompt — and being asked twice to get a decoration was a bad trade
// while the decoration was a sine wave.
//
// It is not a decoration any more. The meter is the only thing on screen while
// you are talking to him, so it has to be the real signal.
//
// THREE THINGS MAKE THIS BEHAVE.
//
//   It shares the voice's AudioContext. A page gets a small number of them and
//   iOS suspends them on a whim; two running at once is how you end up with
//   neither.
//
//   It is never connected to the speakers. The source goes to an analyser and
//   stops there. Wiring a live microphone to the output is a feedback loop with
//   a face.
//
//   IT ASKS FOR RAW AUDIO. Echo cancellation, noise suppression and automatic
//   gain are all off, and that is deliberate — they are three different ways of
//   flattening exactly the dynamics being drawn. AGC in particular pushes a
//   whisper and a shout to the same level, which is the opposite of a meter.
//   What makes raw audio usable is the moving noise floor in `audio.ts`: with a
//   fixed threshold the room would sit a quarter of the way up the screen.
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
  /** What is listening, for whatever wants to read it. Null until opened. */
  readonly analyser: AnalyserNode | null;
  /** Let go of the microphone entirely — the indicator goes out. */
  close: () => void;
}

export function createMic(): Mic {
  let stream: MediaStream | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let refused = false;

  const open = async (context: AudioContext) => {
    if (analyser) return true;
    if (refused || !navigator.mediaDevices?.getUserMedia) return false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Raw. See the note above: every one of these three is a way of
        // flattening the thing being measured.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      // Denied, or no device. Either way this asks once and never again.
      refused = true;
      return false;
    }
    analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    /* Low, and that matters. The browser's own smoothing is a lag between what
       you say and what is drawn; the drawing does its own easing, where it can
       be asymmetric — fast to rise, slow to fall — which this cannot. */
    analyser.smoothingTimeConstant = 0.6;
    source = context.createMediaStreamSource(stream);
    // Into the analyser and NOWHERE ELSE. No connection to the destination.
    source.connect(analyser);
    return true;
  };

  return {
    open,
    get on() { return analyser !== null; },
    get refused() { return refused; },
    get analyser() { return analyser; },
    close: () => {
      for (const track of stream?.getTracks() ?? []) track.stop();
      source?.disconnect();
      stream = null;
      source = null;
      analyser = null;
    },
  };
}
