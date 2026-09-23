// Hearing him. The browser's own speech recognition — no key, no proxy, and on
// iOS the audio does leave the device, which is why it needs its own permission
// grant separate from anything else that wants the microphone.
//
// Safari supports it but is stricter about the gesture and drops the session far
// more often than Chrome, hence the restart in `onend`.

/* eslint-disable @typescript-eslint/no-explicit-any */
type SR = any;

const Recognition: (new () => SR) | undefined =
  (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

export const canListen = !!Recognition;

export interface ListenConfig {
  /** How long the words have to stop changing before the sentence is finished.
   *  Recognition's own `isFinal` waits for the room to go quiet, and a room with
   *  a fridge in it never does — so the gap is measured here instead. */
  gapMs: number;
  /** Silence after he stops talking, to cover room reverb coming back in. */
  echoTailMs: number;
}

export const DEFAULT_LISTEN: ListenConfig = { gapMs: 620, echoTailMs: 1200 };

/**
 * How long one of his own sentences stays on file as something that might come
 * back at him.
 *
 * Long, because the leak this catches is not the reverb tail. Recognition holds
 * an utterance open until it decides it has finished, so audio picked up while
 * he was talking can be handed over seconds AFTER he stopped, by which time
 * every timing gate has expired. That is what produced a man who thought he was
 * being repeated back at himself.
 */
const REMEMBER_SAID_MS = 14000;
/** How much of a heard sentence has to line up with something he just said,
 *  IN ORDER, before it is treated as his own voice. High enough that agreeing
 *  with him is not mistaken for it. */
const ECHO_MATCH = 0.7;

const words = (t: string) => String(t || '')
  .toLowerCase()
  /* Typographic apostrophes FIRST, and this is not a tidy-up. His written lines
     carry ’ — the intros and the quips are typed that way on purpose — and
     recognition hands back '. Stripping the curly one instead of folding it
     turns "I’m" into two one-letter tokens that the length filter then throws
     away, so a three-word greeting arrives here as one word and stops being
     enough to identify. That is a real echo getting through. */
  .replace(/[\u2018\u2019\u02bc\u0060\u00b4]/g, "'")
  .replace(/[^a-z0-9' ]+/g, ' ')
  .split(/\s+/)
  .filter((w) => w.length > 1);

/**
 * How much of `heard` appears inside `said`, in order — the length of their
 * longest common subsequence over the length of `heard`.
 *
 * IN ORDER is what makes this safe. Recognition of the same audio gives a
 * different transcript than the text that was spoken — it drops words, splits
 * contractions and mangles names — so an exact match catches almost nothing and
 * a bag-of-words match catches ordinary agreement ("yeah, the kitchen"). A
 * subsequence is loose about the gaps and strict about the order, which is the
 * shape a garbled recording of a known sentence actually has.
 */
function overlap(heard: string[], said: string[]): number {
  if (!heard.length || !said.length) return 0;
  let prev = new Uint16Array(said.length + 1);
  let row = new Uint16Array(said.length + 1);
  for (let i = 0; i < heard.length; i++) {
    for (let j = 0; j < said.length; j++) {
      row[j + 1] = heard[i] === said[j] ? prev[j] + 1 : Math.max(row[j], prev[j + 1]);
    }
    [prev, row] = [row, prev];
    row.fill(0);
  }
  return prev[said.length] / heard.length;
}

export interface Ears {
  /** Ask for the microphone and start. Must be called from a user gesture. */
  start: () => void;
  stop: () => void;
  /**
   * Deafen him while he talks: he hears himself through the speaker and answers
   * his own reply, forever.
   *
   * DOES NOT STOP THE SESSION. iOS plays a system tone on every
   * `recognition.start()`, and it is not suppressible from a page — so the way
   * to stop hearing it constantly is to start the recogniser as rarely as
   * possible. Aborting and restarting around every single reply meant a tone per
   * exchange; this keeps the session up and throws the results away instead,
   * which costs nothing and is silent.
   */
  mute: () => void;
  /** Listen again, after the echo tail. */
  unmute: () => void;
  /**
   * Tell it something he is about to say, so it can recognise the same words
   * arriving back through the microphone and throw them away.
   *
   * The timing gates are the first line and they are not enough on their own:
   * recognition can hand over an utterance seconds after the audio that made
   * it. This is the one that actually holds, and it holds even where the
   * browser's echo canceller does not.
   */
  spoke: (text: string) => void;
  /** True once the session is up, muted or not — i.e. the mic has been started
   *  and does not need starting again. */
  readonly listening: boolean;
  /** True while he is talking and nothing heard is being kept. */
  readonly muted: boolean;
  /** Interim text, as it is being said. */
  onPartial?: (text: string) => void;
  /** A finished sentence. */
  onSentence?: (text: string) => void;
  onStatus?: (text: string) => void;
}

export function createEars(config: ListenConfig = DEFAULT_LISTEN): Ears {
  let rec: SR | null = null;
  let on = false;
  let muted = false;
  let echoUntil = 0;
  // The last thing heard and when it last changed. Both are cleared the moment
  // a sentence is handed on, so a straggler cannot be answered twice.
  let heard = '';
  let heardAt = 0;
  let swallowUntil = 0;
  /** The last few things he said, with when he said them. */
  let mine: { words: string[]; at: number }[] = [];

  const api: Ears = {
    start, stop, mute, unmute, spoke,
    get listening() { return on; },
    get muted() { return muted; },
  };

  function spoke(text: string) {
    const w = words(text);
    if (w.length < 2) return;
    const now = performance.now();
    mine = mine.filter((m) => now - m.at < REMEMBER_SAID_MS).slice(-5);
    mine.push({ words: w, at: now });
  }

  /** Is this him, coming back through the speaker? */
  function isEcho(text: string): string | null {
    const w = words(text);
    // One word is not enough to tell apart from somebody saying "yeah".
    if (w.length < 2) return null;
    const now = performance.now();
    for (const said of mine) {
      if (now - said.at > REMEMBER_SAID_MS) continue;
      if (overlap(w, said.words) >= ECHO_MATCH) return said.words.join(' ');
    }
    return null;
  }

  /** Recognition's own final result and our gap timer race; whichever wins,
   *  the other must not fire on the same sentence. */
  const deliver = (text: string) => {
    const said = text.trim();
    heard = '';
    if (!said) return;
    const echo = isEcho(said);
    if (echo) {
      /* His own voice. Dropped rather than answered, and the swallow window is
         still set: whatever comes after it is the rest of the same sentence
         arriving. */
      console.log(`heard himself — "${said}" (his own "${echo.slice(0, 60)}…")`);
      swallowUntil = performance.now() + 1500;
      return;
    }
    swallowUntil = performance.now() + 3000;
    api.onSentence?.(said);
  };

  const tick = () => {
    if (!on || muted || !heard) return;
    if (performance.now() - heardAt < config.gapMs) return;
    deliver(heard);
  };
  const timer = window.setInterval(tick, 80);

  function build() {
    const r = new Recognition!();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    r.onstart = () => api.onStatus?.('listening');
    r.onerror = (e: any) => {
      // `no-speech` and `aborted` are routine; anything else is worth saying.
      if (e?.error && e.error !== 'no-speech' && e.error !== 'aborted') {
        api.onStatus?.(`mic: ${e.error}`);
      }
    };
    r.onend = () => {
      /* Safari ends the session on its own schedule. If we still want it, start
         it again — INCLUDING WHILE MUTED, because muting no longer aborts: a
         session that dies mid-reply and is not restarted leaves him deaf for
         good, and being deaf forever is worse than one more start tone. */
      if (on) { try { r.start(); } catch { /* already starting */ } }
    };
    r.onresult = (e: any) => {
      if (muted || performance.now() < echoUntil) return;   // that was us
      let final = '', interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      final = final.trim();
      const live = `${final} ${interim}`.trim();
      if (live && live !== heard) { heard = live; heardAt = performance.now(); }
      if (!final && interim.trim()) api.onPartial?.(interim.trim());
      if (final) {
        // Already sent it ourselves a moment ago, on the gap rather than on this.
        if (performance.now() < swallowUntil) { heard = ''; return; }
        deliver(final);
      }
    };
    return r;
  }

  function start() {
    if (!Recognition) { api.onStatus?.('this browser has no speech recognition'); return; }
    if (on) return;
    on = true;
    muted = false;
    rec = build();
    try { rec.start(); } catch { /* a second start while one is live throws */ }
  }

  function stop() {
    on = false;
    muted = false;
    if (rec) { try { rec.stop(); } catch { /* already stopped */ } }
    rec = null;
    heard = '';
    mine = [];
  }

  function mute() {
    if (!on || muted) return;
    muted = true;
    heard = '';
  }

  function unmute() {
    if (!on || !muted) return;
    muted = false;
    /* Whatever the recogniser accumulated while he was talking is his own voice
       coming back through the speaker. The session stayed up, so it is still
       holding it — drop it, and ignore the tail of the room's reverb too. */
    heard = '';
    swallowUntil = performance.now() + 2000;
    echoUntil = performance.now() + config.echoTailMs;
  }

  window.addEventListener('pagehide', () => { window.clearInterval(timer); stop(); });
  return api;
}
