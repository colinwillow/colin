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
import { createFace, type Face } from './visemes';
import type { GraftedHead } from './head';
import type { Character } from './character';
import type { createWander } from './wander';

type Wander = ReturnType<typeof createWander>;

export interface TalkOptions {
  /** The Worker: Claude on `POST /`, ElevenLabs on `POST /speak`. */
  endpoint: string;
  /** Which character the Worker should answer and speak as. */
  persona?: string;
  /** The mesh carrying the viseme shapes. Without one he still talks; his mouth
   *  just does not move, which is the state while the shapes are being sculpted. */
  head: GraftedHead | null;
  colin: Character;
  wander: Wander;
  camera: THREE.Camera;
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
  face: Face | null;
}

/** How fast he turns to face you once you have said something, in degrees per
 *  second. Slower than the wander's turn: this is attention, not a manoeuvre. */
const ATTEND_DEG = 90;

export function createConversation(opts: TalkOptions): Conversation {
  const { endpoint, persona, head, colin, wander, camera } = opts;

  const brain = createBrain(endpoint, persona);
  const voice = createVoice(endpoint, persona);
  const ears = createEars();
  const face = head ? createFace(head) : null;

  const say = document.getElementById('say');
  const mic = document.getElementById('mic') as HTMLButtonElement | null;

  // Held from the moment a sentence is heard until the last sample has played:
  // this is what stops him wandering off and what turns him to face you.
  let engaged = false;
  let listening = false;

  const caption = (heard: string, reply: string) => {
    if (!say) return;
    say.innerHTML = '';
    if (heard) {
      const b = document.createElement('b');
      b.textContent = `${heard} `;
      say.appendChild(b);
    }
    if (reply) say.appendChild(document.createTextNode(reply));
  };
  const status = (text: string) => { if (say && !say.childNodes.length) say.textContent = text; };

  const engage = (yes: boolean) => {
    if (engaged === yes) return;
    engaged = yes;
    if (yes) { wander.halt(); wander.config.enabled = false; }
    else wander.config.enabled = true;
    mic?.classList.toggle('busy', yes);
    if (mic && listening) mic.textContent = yes ? 'his turn' : 'listening';
  };

  const answer = async (heard: string) => {
    if (brain.busy) return;
    ears.mute();
    engage(true);
    caption(heard, '…');
    let reply = '';
    try {
      reply = await brain.ask(heard, (soFar) => caption(heard, soFar));
    } catch (err) {
      caption(heard, `(${err instanceof Error ? err.message : String(err)})`);
      engage(false);
      ears.unmute();
      return;
    }
    if (!reply) { engage(false); ears.unmute(); return; }
    const started = await voice.speak(reply);
    if (!started) {
      // No voice — the text is still the answer, so leave it on screen.
      engage(false);
      ears.unmute();
    }
  };

  voice.onEnd = () => {
    engage(false);
    ears.unmute();
  };

  ears.onPartial = (text) => { if (!brain.busy && !voice.speaking) caption(text, ''); };
  ears.onSentence = (text) => { void answer(text); };
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
        ears.stop();
        voice.stop();
        engage(false);
        mic.classList.remove('on');
        mic.textContent = 'talk';
        caption('', '');
        return;
      }
      listening = true;
      mic.classList.add('on');
      mic.textContent = 'listening';
      // Both on the tap, because the tap is the only gesture we are guaranteed:
      // the AudioContext will not start without one and neither will the
      // recogniser. They are two separate permissions and nothing here can merge
      // them — the Web Speech API does not expose its stream.
      void voice.arm();
      ears.start();
    });
  }

  const update = (dt: number) => {
    voice.update();
    face?.update(dt, voice.shape());
    if (!engaged) return;
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
    update, brain, voice, ears, face,
    say: (text: string) => { void answer(text); },
    get listening() { return listening; },
  };
}
