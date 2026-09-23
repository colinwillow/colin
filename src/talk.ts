// The conversation: what he hears, what he answers, and what his mouth does
// while he answers it.
//
// Four pieces that each know nothing about the others — ears, brain, voice,
// face — and this is the only place their order matters. The order is the whole
// design:
//
//   1. Deafen him the moment a sentence lands, not when the audio starts. The
//      round trip to the model is a second or two of him standing there with
//      the microphone open, and everything it picks up in that window belongs
//      to the question that has already been asked.
//   2. Stop him walking. A man who strolls off mid-answer reads as broken, and
//      the wander's own facing limit is not tight enough for a conversation.
//   3. Speak, then hand the microphone back after the echo tail.
import * as THREE from 'three';
import { createBrain, type Brain } from './brain';
import { createVoice, type Voice } from './voice';
import { createEars, canListen, type Ears } from './listen';
import { createMic, type Mic } from './mic';
import { createMouth, type Mouth } from './visemes';
import { createWave, type Wave } from './wave';
import { moodFor, EXPRESSION_FOR, type Mood } from './mood';
import { createCommands, type Command, type Commands } from './commands';
import { nextIntro } from './intros';
import type { Poses } from './poses';
import type { FaceRig, Alive } from './face';
import type { Character } from './character';
import type { createWander } from './wander';

type Wander = ReturnType<typeof createWander>;

export interface TalkOptions {
  /** The Worker: Claude on `POST /`, ElevenLabs on `POST /speak`. */
  endpoint: string;
  /** Which character the Worker should answer and speak as. */
  persona?: string;
  /** His face. Without one he still talks; his mouth just does not move. */
  face: FaceRig | null;
  /** The idle layer — blinks, gaze, brows. Told when to look at you. */
  alive: Alive | null;
  colin: Character;
  wander: Wander;
  camera: THREE.Camera;
  /** The clips, and the thing that runs them. Without it he still talks; he
   *  just cannot be told to do anything, and "do a dance" goes to the model
   *  like any other sentence. */
  poses?: Poses;
  /** Whether the scene he is standing in has a floor to walk on. Asked when a
   *  conversation ends, rather than assuming the answer is yes: a studio
   *  backdrop is one room he must not stroll out of. */
  canWander?: () => boolean;
}

export interface Conversation {
  /** Per frame, after the wander has moved him. */
  update: (dt: number) => void;
  /** Type at him instead of talking, for a desktop with no microphone. */
  say: (text: string) => void;
  readonly listening: boolean;
  brain: Brain;
  voice: Voice;
  ears: Ears;
  mouth: Mouth | null;
  /** Your voice as audio, for the meter. Separate from the recogniser, which
   *  hears words rather than sound. */
  heard: Mic;
  /** The bottom-of-screen level meter, drawn from the render loop. */
  wave: Wave | null;
  /** What the last exchange put him in. Drives which idle he falls into. */
  readonly mood: Mood;
  /** Orders he can take, resolved against the clips this export shipped. */
  readonly commands: Commands | null;
}

/** How fast he turns to face you once you have said something, in degrees per
 *  second. Slower than the wander's turn: this is attention, not a manoeuvre. */
const ATTEND_DEG = 90;

export function createConversation(opts: TalkOptions): Conversation {
  const { endpoint, persona, face, alive, colin, wander, camera } = opts;
  const canWander = opts.canWander ?? (() => true);

  /* WHAT HE CAN BE TOLD TO DO, resolved against the clips that actually
     loaded. An order never reaches the model — see commands.ts for why, and
     for the fact that "like this" was the reason. */
  const commands = opts.poses
    ? createCommands({
      clips: colin.clips,
      poses: opts.poses,
      wander,
      canWalk: canWander,
    })
    : null;
  if (commands) console.log(`commands — he can be told to: ${commands.able.join(', ')}`);

  const brain = createBrain(endpoint, persona);
  const voice = createVoice(endpoint, persona);
  const ears = createEars();
  const listen = createMic();
  const mouth = face ? createMouth(face) : null;

  const say = document.getElementById('say');
  const mic = document.getElementById('mic') as HTMLButtonElement | null;
  const chip = document.getElementById('captions') as HTMLButtonElement | null;
  const canvas = document.getElementById('wave') as HTMLCanvasElement | null;
  const wave = canvas ? createWave(canvas, { voice, mic: listen }) : null;

  /* OFF UNTIL ASKED FOR. A conversation is meant to be heard, and a running
     transcript over the top of it turns him into a screen with a video on it —
     the words arrive in his voice and the subtitles are for the times that is
     not enough. The chip in the corner is the way back to them, and the choice
     is remembered, because it is a preference rather than a state.
     Tapping the text itself puts them away, which is where anyone annoyed by
     them is already looking. */
  const CAPTIONS_KEY = 'colin.captions.v1';
  let captionsOn = false;
  try { captionsOn = localStorage.getItem(CAPTIONS_KEY) === 'on'; } catch { /* no storage */ }
  const showCaptions = (on: boolean) => {
    captionsOn = on;
    say?.classList.toggle('off', !on);
    // A toggle that is always there, rather than a chip that appears only while
    // the thing it turns on is off. It sits in a fixed slot in the dock, and a
    // control that vanishes leaves a hole in the row it was holding open.
    chip?.classList.toggle('on', on);
    if (!on && say) say.textContent = '';
    try { localStorage.setItem(CAPTIONS_KEY, on ? 'on' : 'off'); } catch { /* no storage */ }
  };
  say?.addEventListener('click', () => showCaptions(false));
  chip?.addEventListener('click', () => showCaptions(!captionsOn));
  showCaptions(captionsOn);

  let mood: Mood = 'neutral';

  // Held from the moment a sentence is heard until the last sample has played:
  // this is what stops him wandering off and what turns him to face you.
  let engaged = false;
  /** Whether the current engagement is holding him toward the camera. Off for
   *  an order that is about going somewhere. */
  let attending = true;
  let listening = false;

  /* The meter follows the MICROPHONE, not the engagement.
     `engaged` is true while he is thinking and answering, which is precisely
     when you are not talking — so keying the meter to it drew your colour while
     he held the floor and nothing at all while you actually spoke. It is on
     whenever the session is open and he is not speaking; `wave` itself takes
     over the moment his first sample plays. */
  const meterFollows = () => { if (wave) wave.meter.mode = listening ? 'listening' : 'idle'; };

  const caption = (heard: string, reply: string) => {
    if (!say || !captionsOn) return;
    say.innerHTML = '';
    if (heard) {
      const b = document.createElement('b');
      b.textContent = `${heard} `;
      say.appendChild(b);
    }
    if (reply) say.appendChild(document.createTextNode(reply));
  };
  const status = (text: string) => { if (say && !say.childNodes.length) say.textContent = text; };

  const engage = (yes: boolean, attend = true) => {
    if (engaged === yes && attending === attend) return;
    engaged = yes;
    attending = yes ? attend : true;
    // Stopping him is what `attend` means. An order to walk across the room
    // engages him without it, so he can answer and go at the same time.
    if (yes) { if (attend) { wander.halt(); wander.config.enabled = false; } }
    // Not `true`: the scene is what decides whether he walks, and finishing a
    // sentence in a studio must not set him off across a backdrop.
    else wander.config.enabled = canWander();
    /* Eyes on you for as long as this lasts. He turns to face the camera while
       engaged, so straight ahead IS at you — and meeting someone's eye is most
       of what separates being answered from being talked near. */
    alive?.lookAt(yes ? 0 : null, 0);
    mic?.classList.toggle('busy', yes);
    if (mic && listening) mic.textContent = yes ? 'his turn' : 'listening';
  };

  /**
   * Where a reply can be cut so that the first half can start being spoken.
   *
   * OR THE END OF WHAT HAS ARRIVED SO FAR, and that `$` is the whole feature.
   * Requiring whitespace after the full stop sounds right and is wrong for a
   * stream: the space belongs to the NEXT token, so a finished sentence does not
   * look finished until the model has started writing the one after it — which
   * is exactly the wait this exists to remove. Measured against a stubbed Worker
   * that pauses a second between sentences, requiring the space gave up the
   * entire second.
   */
  const SENTENCE_END = /[.!?…]["')\]]*(?:\s|$)/g;

  /** The end of the last complete sentence in `text` at or after `from`, or -1. */
  const lastSeam = (text: string, from: number) => {
    SENTENCE_END.lastIndex = from;
    let cut = -1;
    for (let m = SENTENCE_END.exec(text); m; m = SENTENCE_END.exec(text)) {
      /* "3.5" and "J. Smith" are not the end of anything. Only a bare full stop
         is ambiguous this way — nobody writes 3!5. */
      const before = text[m.index - 1] ?? '';
      if (m[0][0] === '.' && /[0-9A-Z]/.test(before)) continue;
      cut = m.index + m[0].length;
    }
    return cut;
  };

  /**
   * An order, carried out on the spot.
   *
   * THE MODEL NEVER SEES IT. It cannot move him, so asking it to do a dance
   * got back a sentence claiming one had happened — "like this" — over a man
   * standing perfectly still, which is worse than no answer at all. Matching
   * here means the clip starts on the frame the sentence lands, and it makes
   * an order the fastest thing in the app: no round trip to think, none to
   * write, and a line that was already on the device.
   *
   * Both halves still go into the transcript even though neither came from the
   * model, because the next thing said is usually about what just happened —
   * "that was terrible" — and a model that was never told there was a dance has
   * nothing to be rude about.
   */
  const obey = async (cmd: Command, heard: string) => {
    if (brain.busy) return;
    ears.mute();
    engage(true, cmd.attend);
    caption(heard, cmd.quip);
    brain.remember('user', heard);
    brain.remember('assistant', cmd.quip);

    /* THE MOVE FIRST, then the words — which is the whole difference between
       doing a thing and announcing one. */
    cmd.run();
    alive?.express(cmd.dodged ? 'doubtful' : 'amused', 4);
    alive?.blinkNow();

    await voice.arm();
    const spoke = await voice.speak(cmd.quip);
    // No voice, so nothing is going to call onEnd: hand hearing back here.
    if (!spoke) { engage(false); ears.unmute(); }
  };

  /** Where a heard sentence goes. Almost everything is a conversation; the few
   *  that are orders are answered without leaving the device. */
  const route = (text: string) => {
    const cmd = commands?.match(text);
    if (cmd) { void obey(cmd, text); return; }
    void answer(text);
  };

  const answer = async (heard: string) => {
    if (brain.busy) return;
    ears.mute();
    engage(true);
    // A beat of thinking on his face while the model is out, so the pause reads
    // as considering rather than as nothing happening.
    alive?.express('thinking', 30);
    caption(heard, '…');

    /* HE STARTS TALKING BEFORE THE REPLY IS FINISHED, and that is most of what
       used to be the pause. Waiting for the whole answer put three waits end to
       end — the model thinking, the model finishing, and the voice rendering —
       when the first sentence of a two-sentence answer exists a long time before
       the second one does. Pushed the moment it is complete, its rendering
       overlaps the writing of the rest. */
    await voice.arm();
    const speech = voice.open();
    let sent = 0;
    const asked = performance.now();
    let firstToken = 0;
    let firstSpoken = 0;
    /* Stamped from inside the promise rather than where it is awaited. He starts
       talking while the reply is still being written, so anything measured after
       `brain.ask` returns is measuring the writing, not the wait. */
    let firstAudio = 0;
    void speech.started.then((ok) => { if (ok) firstAudio = performance.now() - asked; });

    let reply = '';
    try {
      reply = await brain.ask(heard, (soFar) => {
        if (!firstToken) firstToken = performance.now() - asked;
        caption(heard, soFar);
        const cut = lastSeam(soFar, sent);
        /* Not every seam: a two-word sentence rendered on its own is a request
           whose overhead is longer than the audio it returns, and a string of
           them makes the seams audible. Below this, wait for the next one. */
        if (cut > sent && cut - sent >= 24) {
          if (!firstSpoken) firstSpoken = performance.now() - asked;
          speech.push(soFar.slice(sent, cut));
          sent = cut;
        }
      });
    } catch (err) {
      speech.close();
      caption(heard, `(${err instanceof Error ? err.message : String(err)})`);
      engage(false);
      ears.unmute();
      return;
    }

    const written = performance.now() - asked;
    const tail = reply.slice(sent).trim();
    if (tail) {
      if (!firstSpoken) firstSpoken = performance.now() - asked;
      speech.push(tail);
    }
    speech.close();

    if (!reply) { engage(false); ears.unmute(); return; }

    /* What the exchange did to him. Read off both halves — what you said and
       what he answered — so a flat reply to a sharp remark still lands. It only
       chooses an idle and an expression today; the point is that the hook is in
       one place for when there is a fighting stance to put behind it. */
    mood = moodFor(heard, reply);
    wander.moodIdle = mood;
    alive?.express(EXPRESSION_FOR[mood], 6);
    // People blink as they start to speak, near enough always.
    alive?.express('neutral', 0);
    alive?.blinkNow();

    const started = await speech.started;
    /* Where the wait actually went, because "he takes a while" is four different
       numbers and only one of them is ours to do anything about. `talking` is
       the one you feel; everything before it is the model and the voice. */
    console.log(`turn — first word ${Math.round(firstToken)}ms · `
      + `first sentence sent ${Math.round(firstSpoken)}ms · `
      + `talking ${Math.round(firstAudio)}ms · `
      + `reply written ${Math.round(written)}ms`);
    if (!started) {
      // No voice — the text is still the answer, so leave it on screen.
      engage(false);
      ears.unmute();
    }
  };

  /** Open the mic for the first time, after the greeting. */
  const openEars = () => {
    if (!listening || ears.listening) return;
    ears.start();
    if (mic) mic.textContent = 'listening';
  };

  voice.onEnd = () => {
    engage(false);
    // The greeting is what opens the mic the first time; every reply after it
    // just hands hearing back.
    if (!ears.listening) openEars();
    else ears.unmute();
  };

  ears.onPartial = (text) => {
    wave?.heard();
    if (brain.busy || voice.speaking) return;
    caption(text, '');
    // Brows up a touch while you are mid-sentence: he is listening.
    alive?.express('listening', 1.2);
    alive?.lookAt(0, 0);
  };
  ears.onSentence = (text) => { route(text); };
  ears.onStatus = status;

  if (mic) {
    mic.disabled = false;
    if (!canListen) {
      mic.textContent = 'no mic';
      mic.disabled = true;
      status('this browser has no speech recognition — try Chrome, or Safari 14.5+');
    }
    mic.addEventListener('click', () => {
      if (listening) {
        listening = false;
        meterFollows();
        ears.stop();
        voice.stop();
        engage(false);
        mic.classList.remove('on');
        mic.textContent = 'talk';
        caption('', '');
        return;
      }
      listening = true;
      meterFollows();
      mic.classList.add('on');
      mic.textContent = 'his turn';
      /* Greet first, listen second.
       *
       * The tap is the only gesture we are guaranteed — the AudioContext will
       * not start without one and neither will the recogniser — but they do not
       * have to happen at the same instant. Saying hello before opening the mic
       * means the recogniser starts once, after he has finished, instead of
       * starting, being talked over by his own greeting, and being restarted.
       * One iOS start tone instead of two, and he is not listening to himself.
       */
      void (async () => {
        engage(true);
        /* Everything that needs a gesture, in the gesture. The context has to
           exist before the microphone can hang off it, and asking for the
           microphone suspends the context on iOS — so it is armed, opened, and
           armed again, which is free when it is already awake. */
        await voice.arm();
        if (voice.context) await listen.open(voice.context);
        await voice.arm();
        const line = nextIntro();
        caption('', line);
        alive?.blinkNow();
        /* He said it, so the transcript has to carry it: several of these ask
           who is there, and the answer arrives as a bare name with nothing in
           front of it unless the model can see what it is answering. */
        brain.remember('assistant', line);
        const spoke = await voice.speak(line);
        // No voice available: no reason to make anyone wait for one.
        if (!spoke) { engage(false); openEars(); }
      })();
    });
  }

  const update = (dt: number) => {
    voice.update();
    mouth?.update(dt, voice.shape());
    wave?.update(dt);
    if (!engaged || !attending) return;
    // Turn to whoever is talking to him. The camera is the only stand-in for a
    // person we have.
    const toCamera = Math.atan2(
      camera.position.x - colin.root.position.x,
      camera.position.z - colin.root.position.z,
    );
    let delta = toCamera - colin.root.rotation.y;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const step = THREE.MathUtils.degToRad(ATTEND_DEG) * dt;
    colin.root.rotation.y += THREE.MathUtils.clamp(delta, -step, step);
  };

  return {
    update, brain, voice, ears, mouth, wave, heard: listen, commands,
    get mood() { return mood; },
    say: (text: string) => { route(text); },
    get listening() { return listening; },
  };
}
