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
//   IT ASKS FOR RAW AUDIO. All three of echo cancellation, noise suppression and
//   automatic gain are off, and the third one is the interesting one.
//
//   Echo cancellation was turned ON here to stop him hearing himself: the
//   reasoning was that iOS runs one audio session for the whole page, so an
//   un-cancelled capture anywhere takes the canceller off the speech recogniser
//   too. The reasoning may well be right. What is certainly true is that THE
//   METER STOPPED READING A VOICE the moment it went on — the same phone, the
//   same room, lines that had been moving for days and then were not.
//
//   Which is not surprising in hindsight. Asking for cancellation puts the
//   capture through the platform's voice-processing chain, and that chain is
//   not three independent switches: on iOS it brings its own gating and its own
//   gain control whatever the other two flags say. Those are the two things
//   this meter exists to draw.
//
//   So it is off again, and the echo is handled where it was always going to
//   have to be handled: `listen.ts` keeps the last few things he said and drops
//   a sentence that lines up with one of them. That was always the half that
//   holds — the timing gates and the canceller are both best-effort, and the
//   word filter is the one that works on a browser where neither does.
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
  /** What the browser actually gave, which is not always what was asked for. */
  readonly applied: MediaTrackSettings | null;
  /** Let go of the microphone entirely — the indicator goes out. */
  close: () => void;
}

export function createMic(): Mic {
  let stream: MediaStream | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let refused = false;
  let applied: MediaTrackSettings | null = null;

  const open = async (context: AudioContext) => {
    if (analyser) return true;
    if (refused || !navigator.mediaDevices?.getUserMedia) return false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Raw. See the note above, and the note in listen.ts about where the
        // echo is actually dealt with.
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
    /* WHAT THE BROWSER ACTUALLY DID, which is not always what was asked for —
       a platform may force its voice-processing chain on and there is no way to
       tell from the constraints. Worth having on the record, because the last
       time the meter went quiet the only way to find out why was to guess. */
    try {
      applied = stream.getAudioTracks()[0]?.getSettings() ?? null;
      console.log('microphone — asked for raw; got '
        + (applied ? Object.entries(applied)
          .filter(([k]) => /echo|noise|gain|sampleRate|channelCount/i.test(k))
          .map(([k, v]) => `${k} ${v}`).join(', ') : 'no settings back'));
    } catch { /* not every browser reports them */ }
    return true;
  };

  return {
    open,
    get on() { return analyser !== null; },
    get refused() { return refused; },
    get analyser() { return analyser; },
    get applied() { return applied; },
    close: () => {
      for (const track of stream?.getTracks() ?? []) track.stop();
      source?.disconnect();
      stream = null;
      source = null;
      analyser = null;
    },
  };
}
