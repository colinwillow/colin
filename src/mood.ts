// What the conversation does to him, without being told to.
//
// Not commands. "Do a backflip" is a different feature, and an easier one — this
// is the part where he reacts to what was said rather than to what he was asked
// for. Say something sharp and he should take it; mention food and he should
// think about the fridge, once there is a fridge to think about.
//
// DELIBERATELY DUMB FOR NOW, and in one place so it can stop being. Reading the
// mood off keywords is a stand-in for asking the model, which is where this
// belongs: the Worker already streams a control frame after a NUL byte, so a
// `mood` on that frame would replace the whole of `moodFor` without anything
// downstream noticing. Until then, keywords are honest about being a guess and
// cost nothing.

export type Mood = 'neutral' | 'happy' | 'sad' | 'guarded' | 'curious' | 'hungry';

/** Matched against both halves of the exchange, lower-cased, word-ish. */
const CUES: { mood: Mood; heard?: RegExp; reply?: RegExp }[] = [
  // What YOU said, which is what he is reacting to.
  { mood: 'guarded', heard: /\b(stupid|idiot|shut up|useless|hate you|ugly|dumb|shut it|pathetic)\b/ },
  { mood: 'sad', heard: /\b(sorry|sad|miss you|died|lonely|awful|terrible|gone)\b/ },
  { mood: 'happy', heard: /\b(love|great|amazing|thank you|thanks|nice one|well done|brilliant|good job)\b/ },
  { mood: 'hungry', heard: /\b(hungry|eat|food|dinner|lunch|breakfast|cook|snack|fridge|coffee)\b/ },
  { mood: 'curious', heard: /\b(why|how come|what if|explain|tell me about|curious|wonder)\b/ },
  // And what he said back, which catches the cases the cue words missed.
  { mood: 'sad', reply: /\b(sorry|afraid|unfortunately|sad|shame)\b/ },
  { mood: 'happy', reply: /\b(ha|haha|love|delighted|glad|brilliant)\b/ },
];

/** Which face goes with which mood. Kept out of face.ts so the expressions stay
 *  a vocabulary rather than a list of moods. */
export const EXPRESSION_FOR: Record<Mood, 'neutral' | 'thinking' | 'amused' | 'doubtful' | 'surprised' | 'listening'> = {
  neutral: 'neutral',
  happy: 'amused',
  sad: 'neutral',
  guarded: 'doubtful',
  curious: 'surprised',
  hungry: 'thinking',
};

/**
 * Which idle suits which mood, matched loosely against whatever the export
 * happens to carry. First pattern that hits a clip wins, and falling through to
 * nothing means "any idle", which is the right answer when the file has no
 * opinion — a missing clip should cost the mood, not the character.
 */
export const IDLE_FOR: Record<Mood, RegExp[]> = {
  neutral: [],
  happy: [/happy|bob|upbeat|wav/i],
  sad: [/sad|exhaust|down/i],
  guarded: [/fight|ready|confront|ninja/i],
  curious: [/look|nails|fan|stretch/i],
  hungry: [/exhaust|stretch/i],
};

const bag = (t: string) => ` ${String(t || '').toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ')} `;

/** First cue that matches wins, and the order above is the priority. */
export function moodFor(heard: string, reply: string): Mood {
  const h = bag(heard);
  const r = bag(reply);
  for (const cue of CUES) {
    if (cue.heard && cue.heard.test(h)) return cue.mood;
    if (cue.reply && cue.reply.test(r)) return cue.mood;
  }
  return 'neutral';
}
