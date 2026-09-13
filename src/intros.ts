// What he says when the microphone comes on.
//
// The orb had this and it was most of its charm: press the button and something
// comes out before you have said anything, so the thing feels switched on rather
// than waiting. Short, different every time, and never the same one twice
// running.
//
// They live here rather than coming from the model on purpose. A round trip to
// Claude just to say hello costs a second and a half at exactly the moment the
// app needs to feel instant — and these are voice, not conversation. The model
// never sees them and they never enter the transcript.
//
// NONE OF THEM ASSUME WHO PRESSED THE BUTTON. That is the whole brief: he does
// not know, it might be anyone, and a couple of these ask. Not all of them,
// because being asked who you are every single time is its own annoyance.

const LINES = [
  'Right. Who’s this, then.',
  'Oh good, company.',
  'Go on then. Surprise me.',
  'You have my attention. Briefly.',
  'Speak. I’ve got nowhere to be.',
  'Somebody pressed the button. Bold.',
  'Well. This is happening.',
  'I’m listening. Allegedly.',
  'Hello. I was mid‑thought, but fine.',
  'Yeah? What.',
  'Ah. So the talking works.',
  'Right, you’ve got me. What is it.',
  'I’m awake. Ish.',
  'New voice. Interesting.',
  'Okay. Say something good.',
  'Here we are, then.',
];

let last = -1;

/** One line, never the one before it. */
export function nextIntro(): string {
  if (LINES.length < 2) return LINES[0] ?? '';
  let i = last;
  while (i === last) i = Math.floor(Math.random() * LINES.length);
  last = i;
  return LINES[i];
}

export const INTRO_COUNT = LINES.length;
