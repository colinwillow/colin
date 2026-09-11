// His voice: the ElevenLabs clone, reached through the Cloudflare Worker so the
// API key never comes near the page. Ported from the Orb/glorp project, where
// the timing and the audio graph were worked out.
import { timelineFromMarks, timelineFromText, shapeAt, type Alignment, type Shape, type Span } from './visemes';

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

export interface Voice {
  /** True from the moment the first sample is scheduled until the last ends. */
  readonly speaking: boolean;
  /** Per frame. Reads the analyser, which is what closes the mouth in the gaps. */
  update: () => void;
  /** The mouth shape right now. */
  shape: () => Shape;
  /** Render and play. Resolves true once he has STARTED talking, not finished. */
  speak: (text: string) => Promise<boolean>;
  /** Cut him off. */
  stop: () => void;
  /** Build or wake the AudioContext. Must be called from a user gesture. */
  arm: () => Promise<void>;
  /** Fires once the last piece has finished playing. */
  onEnd?: () => void;
  volume: number;
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
    update, shape, speak, stop, arm, volume: 1,
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

  async function speak(text: string): Promise<boolean> {
    const parts = split(text);
    if (!parts.length) return false;
    await arm();
    if (!ctx || !analyser) return false;

    let first: Piece;
    try {
      first = await render(parts[0], '', parts[1] ?? '');
    } catch (err) {
      console.warn('voice:', err);
      return false;
    }

    stop();
    const mine = ++generation;
    const t0 = ctx.currentTime + 0.05;
    let at = t0;
    let placed = 0, ended = 0, expected = parts.length;

    /* Only the clip actually playing gets to say the talking has stopped.
       Interrupting one fires the OLD source's onended, which would hand the
       microphone back in the middle of the new sentence. */
    const finish = () => {
      if (mine !== generation) return;
      playing = false;
      api.onEnd?.();
    };
    const onEnd = () => { if (mine === generation && ++ended >= expected) finish(); };

    const place = (piece: Piece) => {
      const src = ctx!.createBufferSource();
      src.buffer = piece.audio;
      src.connect(analyser!);
      // Never in the past. A piece that arrives after the one before it has
      // finished would be played immediately anyway, so take the REAL time and
      // offset the mouth by that. A late seam is a small gap; a late seam with
      // the visemes still on the old clock is a mouth out of sync for the rest
      // of the reply.
      const when = Math.max(ctx!.currentTime + 0.01, at);
      src.onended = onEnd;
      src.start(when);
      sources.push(src);
      if (piece.marks) {
        const spans = timelineFromMarks(piece.marks, when - t0);
        seq = placed > 0 ? seq.concat(spans) : spans;
      }
      placed++;
      at = when + piece.audio.duration;
    };

    place(first);
    // Without marks the timeline is a guess from the text and a duration, and
    // only the first piece's duration is known yet — so scale it by how much of
    // the reply that piece was.
    if (!first.marks) {
      seq = timelineFromText(text, first.audio.duration * (text.length / (parts[0].length || 1)));
    }
    if (gain) gain.gain.value = api.volume;
    playing = true;
    /* THE CLOCK STARTS HERE, not when the timeline was built. Decoding, wiring
       the graph and the gain ramp all happen before the first sample is heard,
       and a mouth stamped at build time runs that much ahead of the voice. */
    startedAt = performance.now() + (t0 - ctx.currentTime) * 1000;

    // The rest, in flight while the first is already being heard. Deliberately
    // not awaited: this promise means "he has started talking".
    void (async () => {
      for (let k = 1; k < parts.length; k++) {
        let piece: Piece;
        try {
          piece = await render(parts[k], parts.slice(0, k).join(' '), parts[k + 1] ?? '');
        } catch (err) {
          console.warn(`voice: piece ${k + 1} of ${parts.length} failed —`, err);
          expected = placed;
          if (ended >= expected) finish();
          return;
        }
        if (mine !== generation) return;      // hushed, or a newer reply took over
        place(piece);
      }
    })();
    return true;
  }

  return api;
}
