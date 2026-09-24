// His voice: the ElevenLabs clone, reached through the Cloudflare Worker so the
// API key never comes near the page. Ported from the Orb/glorp project, where
// the timing and the audio graph were worked out.
import { timelineFromMarks, timelineFromText, shapeAt, type Alignment, type Shape, type Span } from './visemes';
export type { Alignment } from './visemes';

/** A reply is spoken a sentence at a time so the first one can start while the
 *  rest is still being rendered. The first piece is kept short because it is the
 *  whole of the wait; later ones are longer because a seam costs more than a
 *  wait nobody is having. */
const CHUNK = { first: 110, rest: 260 };

function split(text: string): string[] {
  const t = String(text || '').trim();
  if (!t) return [];
  // Sentence ends only: a seam mid-clause is audible, a seam at a full stop is not.
  const bits = (t.match(/[^.!?…]+(?:[.!?…]+["')\]]*\s*|\s*$)/g) ?? [t]).filter((b) => b.trim());
  if (bits.length < 2 || t.length <= CHUNK.first) return [t];
  const out: string[] = [];
  let cur = '';
  for (const b of bits) {
    const cap = out.length ? CHUNK.rest : CHUNK.first;
    if (cur && (cur.length + b.length) > cap) { out.push(cur.trim()); cur = b; }
    else cur += b;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

interface Piece { audio: AudioBuffer; marks: Alignment | null }

/** Below this the mouth closes: a written sentence has no silences in it — the
 *  pauses a person leaves are between the words, not in the spelling — so a
 *  purely text-driven mouth keeps shaping through them. */
const GATE = 0.06;

/**
 * A reply being spoken while it is still being written.
 *
 * THE POINT OF THIS IS THE PAUSE BEFORE HE ANSWERS. Waiting for the whole reply
 * before sending any of it to be spoken stacks three waits end to end: the model
 * thinking, the model finishing, and then the voice rendering. The first sentence
 * of a two-sentence answer exists a long time before the second one does, and
 * there is nothing to be gained by sitting on it — pushed the moment it is
 * complete, its rendering overlaps the writing of everything after it.
 */
export interface Speech {
  /** Say this next. Rendered and queued in order; safe to call at any time. */
  push: (text: string) => void;
  /**
   * Queue something that was rendered a long time ago.
   *
   * A narration is baked once and committed, so there is nothing to ask the
   * voice engine for — but everything downstream of the request is identical,
   * and that is the point of putting it here rather than in a player of its
   * own. The scheduling is already sample-accurate across a seam, the mouth
   * already reads the timeline, the meter already reads the analyser, and
   * `onEnd` already hands the microphone back. A separate path would be a
   * second copy of all of it, drifting.
   *
   * `skip` starts that part some way in, which is how a paused narration
   * resumes where it was rather than at the top of the paragraph.
   */
  place: (audio: AudioBuffer, marks: Alignment | null, text: string, skip?: number) => void;
  /** Nothing more is coming. `onEnd` fires once what is queued has played. */
  close: () => void;
  /** True once the first sample is scheduled, false if nothing could be said. */
  started: Promise<boolean>;
}

export interface Voice {
  /** True from the moment the first sample is scheduled until the last ends. */
  readonly speaking: boolean;
  /** Per frame. Reads the analyser, which is what closes the mouth in the gaps. */
  update: () => void;
  /** The mouth shape right now. */
  shape: () => Shape;
  /** Render and play a finished reply. Resolves true once he has STARTED
   *  talking, not finished. Shorthand for `open` / `push` / `close`. */
  speak: (text: string) => Promise<boolean>;
  /** Start a reply that is still arriving. */
  open: () => Speech;
  /** Cut him off. */
  stop: () => void;
  /** Build or wake the AudioContext. Must be called from a user gesture. */
  arm: () => Promise<void>;
  /** Fires once the last piece has finished playing. */
  onEnd?: () => void;
  volume: number;
  /** 0–1, how loud he is right now. Already smoothed. */
  readonly level: number;
  /** Fill `into` with the current waveform, -1..1. False when nothing is
   *  playing, in which case `into` is left alone. */
  waveform: (into: Float32Array) => boolean;
  /** What is playing, for whatever wants to read it. Null until armed. */
  readonly analyser: AnalyserNode | null;
  /** The context this built, once armed — so the microphone can share it rather
   *  than opening a second one. A page gets a small number of these, and two
   *  running at once on iOS is how you end up with neither. */
  readonly context: AudioContext | null;
}

export function createVoice(endpoint: string, persona?: string): Voice {
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let gain: GainNode | null = null;
  let time: Float32Array<ArrayBuffer> | null = null;

  let playing = false;
  let level = 0;
  let generation = 0;
  let sources: AudioBufferSourceNode[] = [];
  let seq: Span[] = [];
  let startedAt = 0;             // performance.now() of the first sample
  const api: Voice = {
    get speaking() { return playing; },
    get level() { return level; },
    waveform: (into) => {
      if (!playing || !analyser) return false;
      /* The analyser's own buffer is fftSize long; whatever the caller brought
         is resampled into it, so the drawing code picks its own resolution. */
      if (!time) return false;
      analyser.getFloatTimeDomainData(time);
      const step = time.length / into.length;
      for (let i = 0; i < into.length; i++) into[i] = time[Math.floor(i * step)];
      return true;
    },
    /* Handed out whether or not anything is playing: the meter decides for
       itself what to do with a silent analyser, and a null here would make
       "armed but between sentences" indistinguishable from "no audio at all". */
    get analyser() { return analyser; },
    get context() { return ctx; },
    update, shape, speak, open, stop, arm, volume: 1,
  };

  async function arm() {
    if (!ctx) {
      ctx = new AudioContext();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.62;
      /* Boost, then limit, then make up what the limiter took. A rendered voice
         sits a long way below full scale, so straight to the speakers a phone at
         maximum sounds like someone talking in the next room. Gain alone would
         clip the peaks; a compressor alone cannot make anything louder. The
         analyser taps the signal BEFORE all of it, so the mouth is reading the
         voice rather than the levelling. */
      gain = ctx.createGain();
      gain.gain.value = api.volume;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -18;
      limiter.knee.value = 2;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      const makeup = ctx.createGain();
      makeup.gain.value = 1.52;
      analyser.connect(gain);
      gain.connect(limiter);
      limiter.connect(makeup);
      makeup.connect(ctx.destination);
      time = new Float32Array(analyser.fftSize);
    }
    // iOS suspends a context whenever the page loses focus, and a permission
    // dialog counts — so the context built during the tap is already asleep by
    // the time the first sentence tries to play. Resuming is free when awake.
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* nothing to do */ } }
  }

  function update() {
    if (!playing || !analyser || !time) { level *= 0.9; return; }
    analyser.getFloatTimeDomainData(time);
    let sum = 0;
    for (let i = 0; i < time.length; i++) sum += time[i] * time[i];
    const rms = Math.sqrt(sum / time.length);
    // No adaptive floor: this is a clean rendered file, not a room.
    const db = 20 * Math.log10(rms + 1e-7);
    const want = Math.min(1, Math.max(0, (db + 52) / 34));
    level += (want - level) * (want > level ? 0.5 : 0.12);
  }

  function shape(): Shape {
    if (!playing || !seq.length || level < GATE) return 'rest';
    return shapeAt(seq, (performance.now() - startedAt) / 1000);
  }

  async function render(text: string, prev: string, next: string): Promise<Piece> {
    const res = await fetch(new URL('/speak', endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // `marks` costs about a third more bytes and is the difference between lip
      // sync and a guess. `prev`/`next` are request stitching: the engine
      // conditions this sentence's prosody on its neighbours, which is what puts
      // the shape back after splitting a reply into pieces.
      body: JSON.stringify({
        text,
        persona: persona || undefined,
        prev: prev || undefined,
        next: next || undefined,
        marks: 1,
      }),
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    // A non-audio 200 — an error page, a redirect, an HTML shell — otherwise
    // fails deep inside decodeAudioData as "Unable to decode audio data", which
    // says nothing about what actually came back.
    const type = res.headers.get('content-type') ?? '';
    const marked = /json/i.test(type);
    if (!marked && !/audio|octet-stream/i.test(type)) {
      throw new Error(`expected audio, got ${type || 'no content-type'}`);
    }
    let raw: ArrayBuffer;
    let marks: Alignment | null = null;
    if (marked) {
      const json = await res.json() as { audio_base64?: string; alignment?: Alignment; normalized_alignment?: Alignment };
      const bin = atob(json.audio_base64 ?? '');
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      raw = bytes.buffer;
      marks = json.normalized_alignment ?? json.alignment ?? null;
    } else {
      raw = await res.arrayBuffer();
    }
    return { audio: await ctx!.decodeAudioData(raw), marks };
  }

  function stop() {
    generation++;
    for (const s of sources) { try { s.stop(); } catch { /* already ended */ } }
    sources = [];
    playing = false;
    seq = [];
  }

  /**
   * Start saying something, a piece at a time.
   *
   * One consumer loop renders the queue IN ORDER, and that is not an accident:
   * each request is conditioned on the text before and after it (see `render`),
   * which is what keeps the prosody continuous across a seam, and rendering two
   * at once would land them in the wrong order as often as not.
   */
  function open(): Speech {
    stop();
    const mine = ++generation;
    if (!ctx || !analyser) {
      // Not armed. Nothing can be said, and saying so is better than queueing
      // into a context that does not exist.
      return { push: () => {}, place: () => {}, close: () => {}, started: Promise.resolve(false) };
    }

    const t0 = ctx.currentTime + 0.05;
    let at = t0;
    let placed = 0;
    let ended = 0;
    /** Unknown until the queue is closed AND drained: a piece that finishes
     *  while more is still being written must not be the last one. */
    let expected = Infinity;

    /** Text still to render, and pieces already rendered, in one queue so that
     *  order is order however each item got here. */
    const pending: { text: string; piece?: Piece; skip?: number }[] = [];
    let closed = false;
    let draining = false;
    /** What he has already said, for conditioning the next request. */
    let said = '';

    let settle: (ok: boolean) => void;
    const started = new Promise<boolean>((resolve) => { settle = resolve; });
    let answered = false;
    const answer = (ok: boolean) => { if (!answered) { answered = true; settle(ok); } };

    /* Only the clip actually playing gets to say the talking has stopped.
       Interrupting one fires the OLD source's onended, which would hand the
       microphone back in the middle of the new sentence. */
    const finish = () => {
      if (mine !== generation) return;
      playing = false;
      api.onEnd?.();
    };
    const onEnd = () => { if (mine === generation && ++ended >= expected) finish(); };

    const place = (piece: Piece, text: string, skip = 0) => {
      const src = ctx!.createBufferSource();
      src.buffer = piece.audio;
      src.connect(analyser!);
      // Never in the past. A piece that arrives after the one before it has
      // finished would be played immediately anyway, so take the REAL time and
      // offset the mouth by that. A late seam is a small gap; a late seam with
      // the visemes still on the old clock is a mouth out of sync for the rest
      // of the reply.
      const when = Math.max(ctx!.currentTime + 0.01, at);
      src.onended = () => {
        /* Dropped as it finishes, not at the end of everything. A narration is
           twenty minutes of decoded audio and holding every buffer until `stop`
           is a couple of hundred megabytes on a phone. */
        const i = sources.indexOf(src);
        if (i >= 0) sources.splice(i, 1);
        onEnd();
      };
      src.start(when, skip);
      sources.push(src);
      /* Without marks the timeline is a guess from the text and the duration.
         Per piece rather than for the whole reply, because with a streamed reply
         there is no whole reply to measure against yet. */
      /* Less `skip`, because a character a minute into the part is heard a
         minute after the part STARTED, not a minute after it was scheduled. */
      const shift = when - t0 - skip;
      const spans = piece.marks
        ? timelineFromMarks(piece.marks, shift)
        : timelineFromText(text, piece.audio.duration - skip).map(
          (span) => ({ ...span, t0: span.t0 + when - t0, t1: span.t1 + when - t0 }));
      seq = placed > 0 ? seq.concat(spans) : spans;
      placed++;
      at = when + Math.max(0, piece.audio.duration - skip);

      if (placed === 1) {
        if (gain) gain.gain.value = api.volume;
        playing = true;
        /* THE CLOCK STARTS HERE, not when the timeline was built. Decoding,
           wiring the graph and the gain ramp all happen before the first sample
           is heard, and a mouth stamped at build time runs that much ahead of
           the voice. */
        startedAt = performance.now() + (t0 - ctx!.currentTime) * 1000;
        answer(true);
      }
    };

    const drain = async () => {
      if (draining) return;
      draining = true;
      while (pending.length) {
        const item = pending.shift()!;
        let piece: Piece;
        if (item.piece) {
          piece = item.piece;
        } else {
          try {
            piece = await render(item.text, said, pending[0]?.text ?? '');
          } catch (err) {
            console.warn(`voice: piece ${placed + 1} failed —`, err);
            // Give up on the rest: a failed piece mid-reply is a hole, and the
            // ones after it would be conditioned on text he never said.
            pending.length = 0;
            closed = true;
            break;
          }
        }
        if (mine !== generation) { draining = false; return; }
        said = `${said} ${item.text}`.trim();
        place(piece, item.text, item.skip);
      }
      draining = false;
      if (closed) {
        expected = placed;
        if (!placed) answer(false);
        else if (ended >= expected) finish();
      }
    };

    return {
      push: (text) => {
        if (closed || mine !== generation) return;
        for (const part of split(text)) pending.push({ text: part });
        void drain();
      },
      place: (audio, marks, text, skip = 0) => {
        if (closed || mine !== generation) return;
        pending.push({ text, piece: { audio, marks }, skip });
        void drain();
      },
      close: () => {
        if (closed) return;
        closed = true;
        // Already idle: settle up now. Otherwise the drain loop does it when it
        // runs out of work.
        if (!draining) void drain();
      },
      started,
    };
  }

  async function speak(text: string): Promise<boolean> {
    await arm();
    const speech = open();
    speech.push(text);
    speech.close();
    return speech.started;
  }

  return api;
}
