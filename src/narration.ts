// Him reading something out, from audio that was made once and kept.
//
// The conversation has to be synthesised every time, because nobody can
// pre-record an answer to a question nobody has asked yet. A twenty-minute
// essay is the opposite: it is the same words every time, so paying for it on
// every play — in credits, in latency, in a network that might not be there —
// is paying repeatedly for something that only had to happen once.
//
// So a reading is BAKED AND COMMITTED: an audio file per part, and the
// character timings that came back with it. `scripts/bake-narration.mjs` makes
// one from the voice engine; `scripts/align-narration.mjs` makes one from a
// recording of the real Colin, which costs nothing and, for fifteen minutes of
// prose, sounds better. Both write the same thing, and nothing below knows or
// cares which it is reading.
//
// IT IS IN PARTS, WHICH IS NOT A COMPROMISE. Three things fall out of it:
// playback starts when the first forty seconds has arrived rather than when
// twenty minutes has; only a few parts are ever decoded at once, where the
// whole essay as PCM is a couple of hundred megabytes on a phone; and the
// seams land at paragraph breaks, where a breath belongs anyway.
//
// And it is played through `voice.open()` — the same queue a spoken reply goes
// through. See the note on `Speech.place`: everything downstream of the request
// is identical, and a second path would be a second copy of all of it.
import type { Voice, Alignment } from './voice';

/** One reading, as the index lists it. */
export interface Reading {
  id: string;
  title: string;
  /** Seconds. What the bake measured, for the list and the progress. */
  duration: number;
  /** Whose voice, in words — "Colin, recorded" or "the voice engine". */
  voice: string;
  words?: number;
  note?: string;
}

/** One reading, with the audio to play it. */
export interface Performance extends Reading {
  parts: {
    /** Relative to the narration folder. */
    audio: string;
    text: string;
    /** Character timings, relative to the start of this part. Null falls back
     *  to guessing the mouth from the text, which is what happens when a
     *  recording was aligned without word timings. */
    marks: Alignment | null;
    /** What the bake measured, used only for the runway below — the decoded
     *  buffer is the authority once it exists. */
    duration?: number;
  }[];
}

export interface Narration {
  /** What has been baked. Empty until something has been. */
  readonly readings: Reading[];
  /** Fetch the index. Safe to call more than once; only reads it once. */
  load: () => Promise<Reading[]>;
  /** Start one, optionally some way in. False when there is nothing to play. */
  play: (id: string, from?: number) => Promise<boolean>;
  /** Stop, and remember where. */
  pause: () => void;
  /** Carry on from there. */
  resume: () => Promise<boolean>;
  /** Stop, and forget where. */
  stop: () => void;
  /** Jump. Takes effect by restarting from the part that contains it. */
  seek: (seconds: number) => Promise<boolean>;
  readonly reading: Reading | null;
  readonly playing: boolean;
  readonly paused: boolean;
  /** Seconds in. Runs off the same clock as the mouth. */
  at: () => number;
  /** Fires when a reading reaches its end, not when it is stopped. */
  onEnd?: () => void;
  /**
   * True when a reading takes the floor, false when it gives it back.
   *
   * What the conversation needs in order to stop him wandering off in the
   * middle of an essay, and to hand the microphone back when somebody stops one
   * half way — the end of a reading releases itself through `voice.onEnd`, but
   * a stop never reaches that.
   */
  onState?: (playing: boolean) => void;
}

/**
 * How far ahead of the playhead to keep audio decoded, in seconds.
 *
 * The whole reason for parts. Twenty minutes of decoded PCM is on the order of
 * two hundred megabytes, which a phone will not give you — so only about a
 * minute of it exists at a time, and the rest is still an MP3 on disk. Long
 * enough that a slow network has time to fetch the next part before it is
 * needed, short enough that the memory never adds up.
 */
const RUNWAY = 55;

export function createNarration(voice: Voice, base: string): Narration {
  const folder = `${base}narration/`;
  let readings: Reading[] = [];
  let loaded = false;

  let reading: Reading | null = null;
  let performance_: Performance | null = null;
  /** Bumped by anything that interrupts, so a fetch that is still in the air
   *  cannot queue audio into a reading that has been stopped. */
  let run = 0;
  let paused = false;
  let playing = false;
  /** performance.now() of where second zero of this reading is — in the past,
   *  and possibly before it started, which is what makes `at()` work after a
   *  resume from the middle. */
  let zero = 0;
  /** Where a pause left it. */
  let held = 0;

  const api: Narration = {
    get readings() { return readings; },
    get reading() { return reading; },
    get playing() { return playing; },
    get paused() { return paused; },
    at: () => {
      if (paused || !playing) return held;
      const t = (window.performance.now() - zero) / 1000;
      return Math.max(0, Math.min(reading?.duration ?? t, t));
    },
    load,
    play,
    pause,
    stop,
    // Both are `play` with a starting point, which is the only kind of seeking
    // a queue of scheduled buffers can honestly do.
    resume: () => (reading ? play(reading.id, held) : Promise.resolve(false)),
    seek: (seconds) => (reading ? play(reading.id, Math.max(0, seconds)) : Promise.resolve(false)),
  };

  async function load() {
    if (loaded) return readings;
    loaded = true;
    try {
      const res = await fetch(`${folder}index.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      readings = (await res.json() as Reading[]).filter((r) => r && r.id);
      console.log(`readings — ${readings.length}: ${readings.map((r) => r.title).join(', ') || 'none'}`);
    } catch {
      // No index is the normal state of a fresh clone, not an error worth
      // shouting about: nothing has been baked yet.
      readings = [];
    }
    return readings;
  }

  async function fetchPerformance(id: string): Promise<Performance | null> {
    try {
      const res = await fetch(`${folder}${id}.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const p = await res.json() as Performance;
      return p.parts?.length ? p : null;
    } catch (err) {
      console.warn(`narration: could not load ${id} —`, err);
      return null;
    }
  }

  function stop() {
    run++;
    const was = playing;
    playing = false;
    paused = false;
    held = 0;
    reading = null;
    performance_ = null;
    voice.stop();
    if (was) api.onState?.(false);
  }

  function pause() {
    if (!playing || paused) return;
    held = api.at();
    paused = true;
    playing = false;
    run++;
    voice.stop();
    api.onState?.(false);
  }

  async function play(id: string, from = 0): Promise<boolean> {
    await load();
    const mine = ++run;
    paused = false;
    playing = false;
    voice.stop();

    if (!performance_ || performance_.id !== id) {
      const next = await fetchPerformance(id);
      if (!next || mine !== run) return false;
      performance_ = next;
    }
    reading = performance_;
    held = from;

    await voice.arm();
    if (mine !== run) return false;
    const speech = voice.open();

    /* Which part `from` lands in, and how far into it. The durations in the
       manifest are what the bake measured; a decoded buffer may differ by a few
       milliseconds, which over a whole essay would drift — so the runway below
       re-reads the real duration and this is only used to find the seam. */
    const parts = performance_.parts;
    let index = 0;
    let skip = from;
    for (; index < parts.length; index++) {
      const d = parts[index].duration ?? 0;
      if (skip < d || index === parts.length - 1) break;
      skip -= d;
    }
    /* Second zero is `from` seconds before now, so `at()` reads as a position
       in the whole piece rather than in this run of it. */
    zero = window.performance.now() - from * 1000;
    playing = true;
    api.onState?.(true);

    void speech.started.then((ok) => {
      if (mine !== run) return;
      if (!ok) { playing = false; return; }
      // Re-stamped on the real start, so the progress does not carry the
      // fetch and the decode as if they were audio.
      zero = window.performance.now() - from * 1000;
    });

    /* Fetch, decode and hand over one part at a time, staying about a minute
       ahead. Awaiting inside the loop is what keeps the memory flat; the queue
       inside `voice` keeps the audio seamless regardless of when each one
       arrives. */
    void (async () => {
      let scheduled = from;
      for (let i = index; i < parts.length; i++) {
        while (mine === run && scheduled - api.at() > RUNWAY) {
          await new Promise((r) => setTimeout(r, 250));
        }
        if (mine !== run) return;
        const part = parts[i];
        try {
          const res = await fetch(`${folder}${part.audio}`, { cache: 'force-cache' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const audio = await voice.context!.decodeAudioData(await res.arrayBuffer());
          if (mine !== run) return;
          const into = i === index ? Math.min(skip, Math.max(0, audio.duration - 0.05)) : 0;
          speech.place(audio, part.marks, part.text, into);
          scheduled += audio.duration - into;
        } catch (err) {
          console.warn(`narration: part ${i + 1} of ${parts.length} failed —`, err);
          break;
        }
      }
      if (mine === run) speech.close();
    })();

    const started = await speech.started;
    if (mine !== run) return false;
    if (!started) { playing = false; return false; }
    return true;
  }

  /* The end of the audio is the end of the reading, and `voice.onEnd` is what
     says so — but it is the conversation's hook, so this wraps rather than
     takes it. */
  const theirs = voice.onEnd;
  voice.onEnd = () => {
    theirs?.();
    if (!playing || paused) return;
    playing = false;
    held = 0;
    console.log(`reading — finished "${reading?.title ?? ''}"`);
    api.onState?.(false);
    api.onEnd?.();
  };

  return api;
}
