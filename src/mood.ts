// How he is feeling, as a number that moves rather than a label that is picked.
//
// The old version read six keywords off an exchange, chose one of six names,
// and threw it away on the next turn. Which meant he had no memory of being
// insulted, no way to be slightly pleased, and nothing that could build: you
// could call him an idiot four times running and get the same flicker of a
// frown each time.
//
// THIS IS TWO NUMBERS AND SOME INERTIA, which is most of what a mood is.
//
//   valence  −1 hurt ……… 0 ……… +1 delighted
//   energy   −1 flat ……… 0 ……… +1 wired
//
// Two axes rather than one because the pair is what separates the feelings that
// matter here. Sad and cross are both unhappy and they are not remotely the same
// face: sad is low energy, cross is high. Content and delighted are the same
// difference the other way up. A single "mood slider" can only ever go from
// frown to smile, and he would never be able to be annoyed.
//
// Everything said moves them a little and nothing snaps, so four insults land
// four times harder than one, and everything drifts back toward level on its own
// over a minute or two — which is the part that makes it read as a mood instead
// of a state machine. Nothing here asks the model: see the note at the bottom
// about where this eventually belongs.

/** The nearest name for a feeling. What the idle picker and the panel speak. */
export type Mood = 'neutral' | 'happy' | 'sad' | 'guarded' | 'curious' | 'hungry';

export interface Feeling {
  /** −1 hurt, +1 delighted. */
  valence: number;
  /** −1 flat, +1 wired. */
  energy: number;
}

export interface Feelings extends Feeling {
  /** Where it sits right now, as a word. */
  readonly label: Mood;
  /** What is on his mind, which is not the same thing as how he feels — being
   *  hungry is not a mood, it is a subject. Decays on its own. */
  readonly topic: Mood | null;
  /** Move it. Deltas, so several cues in one sentence add up and so does one
   *  cue across several sentences. */
  nudge: (by: Partial<Feeling>) => void;
  /** Put it somewhere outright. The sliders, and the presets. */
  set: (to: Partial<Feeling> & { topic?: Mood | null }) => void;
  /** Drift back toward level. From the render loop. */
  update: (dt: number) => void;
  /**
   * Read an exchange and move accordingly.
   *
   * Both halves, because a flat reply to a sharp remark still landed, and
   * because half of what he feels he talks himself into.
   */
  react: (heard: string, reply: string) => { cues: string[]; before: Feeling; after: Feeling };
}

/**
 * What moves him, and by how much.
 *
 * The numbers are small on purpose. One remark should be a lean, not a lurch —
 * about a fifth of the range — so that the thing you notice is the ACCUMULATION.
 * Being mean once gets a flicker; being mean four times in a row gets a man who
 * has had enough, and that is the behaviour worth having.
 */
const CUES: { name: string; heard?: RegExp; reply?: RegExp; valence?: number; energy?: number; topic?: Mood }[] = [
  // --- what you said, which is what he is reacting to ---
  { name: 'insulted', heard: /\b(stupid|idiot|shut up|useless|hate you|ugly|dumb|shut it|pathetic|rubbish|boring|annoying|worst|awful|terrible|suck|sucks|lame|cringe)\b/, valence: -0.42, energy: 0.3 },
  { name: 'sworn at', heard: /\b(f+u+c+k|shit|piss off|arsehole|asshole|bastard|twat|prick|bollocks)\b/, valence: -0.3, energy: 0.35 },
  { name: 'argued with', heard: /\b(no you|you're wrong|thats wrong|that's wrong|not true|nonsense|disagree|rubbish|prove it|says who)\b/, valence: -0.2, energy: 0.3 },
  { name: 'complimented', heard: /\b(love|amazing|brilliant|great|awesome|clever|funny|well done|good job|nice one|thank you|thanks|cheers|you're good|best)\b/, valence: 0.4, energy: 0.22 },
  { name: 'laughed at with', heard: /\b(haha|hahaha|lol|lmao|that's funny|thats funny|hilarious)\b/, valence: 0.32, energy: 0.28 },
  { name: 'commiserated', heard: /\b(sorry|sad|miss you|died|lonely|gutted|miserable|depressed|rough day|bad day|crying)\b/, valence: -0.3, energy: -0.35 },
  { name: 'wound up', heard: /\b(hurry|come on|do it|now|faster|again|wake up|pay attention)\b/, energy: 0.22 },
  { name: 'calmed', heard: /\b(relax|calm down|take your time|no rush|it's fine|its fine|never mind|forget it)\b/, energy: -0.3, valence: 0.05 },
  { name: 'bored at', heard: /\b(tired|exhausted|knackered|sleepy|late|bed|long day|boring)\b/, energy: -0.3 },
  { name: 'excited at', heard: /\b(can't wait|cant wait|excited|amazing|incredible|no way|holy|wow|let's go|lets go|party|birthday)\b/, valence: 0.25, energy: 0.4 },
  { name: 'asked about food', heard: /\b(hungry|eat|food|dinner|lunch|breakfast|cook|snack|fridge|coffee|pizza|starving)\b/, topic: 'hungry', energy: 0.08 },
  { name: 'asked a real question', heard: /\b(why|how come|what if|explain|tell me about|curious|wonder|how does|what happens)\b/, topic: 'curious', energy: 0.15 },
  // --- and what he said back, which catches the ones the cue words missed ---
  { name: 'he softened', reply: /\b(sorry|afraid|unfortunately|sad|shame|fair enough|you're right|youre right)\b/, valence: -0.12, energy: -0.12 },
  { name: 'he laughed', reply: /\b(ha|haha|love it|delighted|glad|brilliant|excellent)\b/, valence: 0.2, energy: 0.15 },
  { name: 'he bit back', reply: /\b(rude|charming|wow|really|seriously|whatever|fine\.|excuse me)\b/, valence: -0.1, energy: 0.2 },
];

/** Which face goes with which name. Kept out of face.ts so the expressions stay
 *  a vocabulary rather than a list of moods — these are the TRANSIENT ones; the
 *  sustained face comes off the two numbers directly. */
export const EXPRESSION_FOR: Record<Mood, 'neutral' | 'thinking' | 'amused' | 'doubtful' | 'surprised' | 'listening'> = {
  neutral: 'neutral',
  happy: 'amused',
  sad: 'neutral',
  guarded: 'doubtful',
  curious: 'surprised',
  hungry: 'thinking',
};

/**
 * Which idle suits which name, matched loosely against whatever the export
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

/** Where the presets and the panel put him. */
export const PRESETS: Record<Mood, Feeling & { topic?: Mood | null }> = {
  neutral: { valence: 0, energy: 0, topic: null },
  happy: { valence: 0.75, energy: 0.5, topic: null },
  sad: { valence: -0.7, energy: -0.5, topic: null },
  guarded: { valence: -0.5, energy: 0.45, topic: null },
  curious: { valence: 0.15, energy: 0.4, topic: 'curious' },
  hungry: { valence: -0.1, energy: -0.05, topic: 'hungry' },
};

/**
 * How long it takes half of a feeling to wear off.
 *
 * Long enough to survive a couple of exchanges — being snapped at should still
 * be readable on him two answers later, or none of this was worth doing — and
 * short enough that a conversation which turns around is allowed to turn him
 * around with it. Energy settles faster than mood does, which is true of people.
 */
const VALENCE_HALF_LIFE = 105;
const ENERGY_HALF_LIFE = 55;
/** A subject he is on decays faster still: it is a thing that came up, not a
 *  thing he is. */
const TOPIC_SECONDS = 40;

const clamp = (v: number) => Math.max(-1, Math.min(1, v));
const bag = (t: string) => ` ${String(t || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ')} `;

/** Which name is nearest to a pair of numbers.
 *
 *  The thresholds are what make the plane legible: inside them he is simply
 *  himself, which is where he should be most of the time. Cross and sad are the
 *  same unhappiness at different energies, and that split is the whole reason
 *  there are two axes. */
export function nameFor({ valence, energy }: Feeling): Mood {
  if (valence <= -0.22) return energy > 0.08 ? 'guarded' : 'sad';
  if (valence >= 0.22) return 'happy';
  return 'neutral';
}

export function createFeelings(start: Feeling = { valence: 0, energy: 0 }): Feelings {
  let valence = clamp(start.valence);
  let energy = clamp(start.energy);
  let topic: Mood | null = null;
  let topicFor = 0;

  const decayTo = (v: number, half: number, dt: number) => v * Math.pow(0.5, dt / half);

  return {
    get valence() { return valence; },
    set valence(v: number) { valence = clamp(v); },
    get energy() { return energy; },
    set energy(v: number) { energy = clamp(v); },
    get topic() { return topicFor > 0 ? topic : null; },
    /* The subject wins the NAME while it lasts, because "hungry" and "curious"
       are not points on this plane and never were — they are things on his mind
       that pick a different idle. How he FEELS is still the two numbers
       underneath, and that is what his face reads. */
    get label() { return (topicFor > 0 && topic) || nameFor({ valence, energy }); },

    nudge: (by) => {
      if (by.valence) valence = clamp(valence + by.valence);
      if (by.energy) energy = clamp(energy + by.energy);
    },

    set: (to) => {
      if (to.valence !== undefined) valence = clamp(to.valence);
      if (to.energy !== undefined) energy = clamp(to.energy);
      if (to.topic !== undefined) { topic = to.topic; topicFor = to.topic ? TOPIC_SECONDS : 0; }
    },

    update: (dt) => {
      valence = decayTo(valence, VALENCE_HALF_LIFE, dt);
      energy = decayTo(energy, ENERGY_HALF_LIFE, dt);
      if (topicFor > 0) topicFor -= dt;
    },

    react: (heard, reply) => {
      const h = bag(heard);
      const r = bag(reply);
      const before = { valence, energy };
      const cues: string[] = [];
      /* EVERY cue that matches, not the first. One sentence can be both an
         insult and an argument, and it should land as both — the old version
         took the first hit and stopped, which is why a paragraph of abuse
         weighed exactly as much as the word "dumb". */
      for (const cue of CUES) {
        if (!((cue.heard && cue.heard.test(h)) || (cue.reply && cue.reply.test(r)))) continue;
        cues.push(cue.name);
        if (cue.valence) valence = clamp(valence + cue.valence);
        if (cue.energy) energy = clamp(energy + cue.energy);
        if (cue.topic) { topic = cue.topic; topicFor = TOPIC_SECONDS; }
      }
      return { cues, before, after: { valence, energy } };
    },
  };
}

/* WHERE THIS BELONGS EVENTUALLY. Reading keywords is a stand-in for asking the
   model, which already knows what it just said and meant. The Worker streams a
   control frame after a NUL byte and brain.ts already splits it off, so a
   `{ valence, energy }` on that frame would replace the table above without
   anything downstream noticing — the inertia, the decay, the face and the idle
   picker all take numbers and do not care where they came from. Until then,
   keywords are honest about being a guess and cost nothing. */
