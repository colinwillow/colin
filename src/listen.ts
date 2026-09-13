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

export const DEFAULT_LISTEN: ListenConfig = { gapMs: 620, echoTailMs: 850 };

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
  /** True once the session is up, muted or not — i.e. the mic has been started
   *  and does not need starting again. */
  readonly listening: boolean;
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

  const api: Ears = {
    start, stop, mute, unmute,
    get listening() { return on; },
  };

  /** Recognition's own final result and our gap timer race; whichever wins,
   *  the other must not fire on the same sentence. */
  const deliver = (text: string) => {
    const said = text.trim();
    heard = '';
    if (!said) return;
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
    swallowUntil = performance.now() + 1500;
    echoUntil = performance.now() + config.echoTailMs;
  }

  window.addEventListener('pagehide', () => { window.clearInterval(timer); stop(); });
  return api;
}
