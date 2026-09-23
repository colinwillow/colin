// Telling him to do something, and him actually doing it.
//
// `mood.ts` is the other half of this and says so at the top: it is what the
// conversation does to him without being asked. This is the asking. "Do a
// dance" used to go to the model like any other sentence, and the model —
// which cannot move him — would answer "like this", which is the worst
// possible outcome: a claim with nothing behind it.
//
// SO IT NEVER REACHES THE MODEL. An order is matched here, on the page, and
// the clip starts on the same frame the sentence lands. That is not only more
// honest, it is the fastest thing in the app: a command answers in about as
// long as it takes to start a sound file, where a round trip to Claude and
// back through ElevenLabs is a second and a half. The thing he says over the
// top comes out of a bank at the bottom of this file, for the same reason the
// greetings do — these are voice, not conversation.
//
// WHAT HE CAN DO IS READ OFF THE EXPORT, never written down. Every move below
// names the clip it wants as a pattern, and a move whose pattern finds nothing
// is not an error — it is a move he cannot do yet, and he dodges the question
// instead. Drop a backflip into `colin.glb` and "do a backflip" starts working
// with nothing here to change. That is the whole reason this table has entries
// for moves the file has never had.
import type { Poses } from './poses';

export interface Command {
  id: string;
  /** What he says while doing it. Spoken locally; never goes to the model. */
  quip: string;
  /** Do the thing. Called before the line is spoken, so the move and the
   *  sentence start together. */
  run: () => void;
  /** He was asked for something the export has no clip for, and is covering. */
  dodged: boolean;
  /**
   * Whether to hold him facing you while this runs.
   *
   * True for almost everything — being answered means being looked at. False
   * for the ones that are about going somewhere, because pinning him to the
   * camera and telling him to walk across the room are the same instruction
   * pulling in two directions, and he ends up sliding sideways.
   */
  attend: boolean;
}

/** Everything a command is allowed to touch. Narrow on purpose: an order can
 *  move him and nothing else. */
export interface Stagecraft {
  clips: string[];
  poses: Pick<Poses, 'perform' | 'release'>;
  wander: {
    config: { enabled: boolean };
    /** Send him off across the room now, rather than when his own pause
     *  happens to end. */
    stroll: (prefer?: 'near' | 'far') => boolean;
    halt: () => void;
  };
  /** Whether the room he is in has a floor to cross. A studio backdrop does
   *  not, and "come here" has to become a joke rather than a walk. */
  canWalk: () => boolean;
}

export interface Commands {
  /** Match a heard sentence. Null when it was not an order, which is most of
   *  them — that is the case where the model still gets the sentence. */
  match: (heard: string) => Command | null;
  /**
   * What an exchange makes him feel like doing, unasked. Null almost always.
   *
   * THIS IS THE OPPOSITE END OF THE SAME MACHINERY. `match` is him being told;
   * this is him deciding, which is the whole difference between a puppet and
   * something that seems to be in the room. Mention a song and he might start
   * dancing — might, because a reaction that fires every time is just a command
   * with extra steps, and one that fires every time is the fastest way to make
   * a trick tiresome.
   *
   * It only ever returns a move the export can actually do: nobody asked, so
   * there is nothing to dodge, and a joke about a backflip nobody requested is
   * a non sequitur rather than a bit.
   */
  suggest: (heard: string, reply: string) => Command | null;
  /** The moves this export turned out to support, for the console. */
  readonly able: string[];
}

interface Move {
  id: string;
  /** What to call it when he lists what he can do. */
  say: string;
  match: RegExp;
  /** Clip-name patterns, best first. Nothing matching means he cannot do it. */
  want: RegExp[];
  /** Seconds to run it for. Left out means the clip's own length, once — which
   *  is right for a wave and wrong for a dance, because a wave is over when the
   *  hand comes down and a loop is over when somebody decides it is. */
  seconds?: number;
  /** Listed as a dance rather than as a thing he does. */
  dance?: boolean;
  /** Matched, but never named in the list — the catch-all for its group. */
  hidden?: boolean;
  /** Lines particular to this one, mixed in with the general ones. */
  quips?: string[];
}

/**
 * Order matters: the specific dance beats the general one, or every moonwalk
 * comes out as a coin toss between six clips.
 */
const MOVES: Move[] = [
  {
    id: 'moonwalk', say: 'the moonwalk', dance: true,
    match: /\b(moonwalk|moon walk|michael jackson|slide backwards)\b/,
    want: [/moonwalk/i], seconds: 7,
    quips: ['Watch the feet.', 'Nineteen eighty-three called. It’s fine about it.'],
  },
  {
    id: 'twerk', say: 'twerking', dance: true,
    match: /\b(twerk\w*|shake (it|that|your))\b/,
    want: [/twerk/i], seconds: 6,
    quips: ['You’re going to regret asking for this.', 'This is on you.', 'Remember that you chose this.'],
  },
  {
    id: 'hiphop', say: 'hip-hop', dance: true,
    match: /\b(hip ?hop|breakdanc\w*|break danc\w*|street danc\w*|krump\w*|pop and lock)\b/,
    want: [/hiphop/i], seconds: 8,
    quips: ['Give me some room.', 'Yeah, I’ve got three of these.'],
  },
  {
    id: 'wiggle', say: 'happy feet', dance: true,
    match: /\b(wiggle\w*|shuffle|happy feet|tap danc\w*|jig)\b/,
    want: [/wiggle/i], seconds: 6,
    quips: ['The feet do most of my thinking.'],
  },
  {
    id: 'dance', say: 'a dance', dance: true, hidden: true,
    match: /\b(danc\w*|boogie|bust a move|get down|groove|moves|bust out)\b/,
    want: [/^dance/i], seconds: 8,
    quips: ['Watch the footwork.', 'Don’t film this.', 'I only know six of these, so pace yourself.'],
  },
  {
    id: 'wave', say: 'waving',
    match: /\b(wave|waving|say (hi|hello)|greet|salute)\b/,
    want: [/wav/i],
    quips: ['Hello then.', 'There. We’re friends now.'],
  },
  {
    id: 'kneel', say: 'kneeling',
    match: /\b(kneel\w*|on your knees|propose|bow|sit( down)?|crouch|get low)\b/,
    want: [/kneel/i], seconds: 5,
    quips: ['This is the closest I get to sitting.', 'Don’t make it weird.'],
  },
  {
    id: 'tired', say: 'looking knackered',
    match: /\b(tired|exhaust\w*|knackered|worn out|nap|sleep|have a rest|collapse|give up)\b/,
    want: [/exhaust/i], seconds: 6,
    quips: ['Didn’t need to act, particularly.', 'Finally, something I’m good at.'],
  },
  {
    id: 'sulk', say: 'sulking',
    match: /\b(sulk\w*|mope|be sad|look sad|pout|kick (a|some)\w*|feel sorry)\b/,
    want: [/sad/i], seconds: 6,
    quips: ['Happy now?', 'I want it on record that you asked for this.'],
  },
  /* These three are in-place cycles — every walk in the file is, since the
     wander is what moves him across a floor — so what he does here is march on
     the spot. Kept anyway, and the lines lean into it: asked to run, a man
     running on the spot in a kitchen asking where he is supposed to be going is
     the right answer. "Walk around" is the one that actually travels, and that
     goes through the wander instead. */
  {
    id: 'swagger', say: 'a strut',
    match: /\b(swagger|strut|catwalk|runway|model|show off)\b/,
    want: [/swagger/i], seconds: 6,
    quips: ['This is just how I walk.'],
  },
  {
    id: 'tiptoe', say: 'sneaking',
    match: /\b(tip ?toe\w*|sneak\w*|creep\w*|quietly|be quiet)\b/,
    want: [/tiptoe/i], seconds: 6,
    quips: ['Nobody can see me now.'],
  },
  {
    id: 'run', say: 'running',
    match: /\b(run|running|jog\w*|sprint|leg it|go faster)\b/,
    want: [/^run/i], seconds: 5,
    quips: ['Where exactly am I going?'],
  },
  /* Everything below this line is a move the export has never had.
     They are here so that asking for one gets an answer with a joke in it
     rather than a paragraph from the model about how it would love to — and so
     that the day one of these clips turns up, it works. */
  { id: 'backflip', say: 'a backflip', match: /\b(back ?flip|backwards flip|somersault|flip)\b/, want: [/flip|somersault/i], seconds: 3 },
  { id: 'cartwheel', say: 'a cartwheel', match: /\b(cart ?wheel|handstand|hand ?stand)\b/, want: [/cartwheel|handstand/i], seconds: 3 },
  /* Anchored, or `hop` finds `dance_hiphop_01` and "jump" comes out as a dance —
     which it did, the first time this ran. A clip pattern is matched against
     names somebody chose for a file, so it has to be worth more than a
     substring. */
  { id: 'jump', say: 'jumping', match: /\b(jump\w*|hop|leap|bounce)\b/, want: [/(^|_)(jump|leap|hop)(_|\d|s|ing|$)/i], seconds: 4 },
  { id: 'pushup', say: 'press-ups', match: /\b(push ?ups?|press ?ups?|sit ?ups?|burpees?|exercise)\b/, want: [/push|press|situp/i], seconds: 6 },
  { id: 'fight', say: 'throwing hands', match: /\b(punch\w*|fight\w*|karate|kung fu|martial|box\w*)\b/, want: [/fight|punch|karate|box/i], seconds: 5 },
  { id: 'spin', say: 'a spin', match: /\b(spin|turn around|180|show me your back|twirl|pirouette)\b/, want: [/spin|twirl|pirouette/i], seconds: 4 },
  { id: 'clap', say: 'clapping', match: /\b(clap\w*|applau\w*|golf clap)\b/, want: [/clap|applau/i], seconds: 3 },
];

/** He walks by wandering, not by playing a walk cycle on the spot: the clips
 *  are all in-place, so the only thing that moves him across the floor is the
 *  wander. These hand him back to it and point it somewhere. */
const GO = [
  { id: 'closer', match: /\b(come (here|closer|over)|get closer|step (forward|closer|up)|over here|nearer)\b/, prefer: 'near' as const },
  { id: 'back', match: /\b(back (up|off|away)|step back|go away|move away|give me (some )?(space|room)|further)\b/, prefer: 'far' as const },
  { id: 'walk', match: /\b(walk( around| about)?|pace|move around|wander|stretch your legs|go for a walk|explore)\b/, prefer: undefined },
];

/**
 * What a subject makes him feel like doing.
 *
 * Nobody asked for any of these, which changes the rules. The chance is there
 * so he is capricious rather than mechanical; the move has to already exist in
 * the export or nothing happens at all; and there is no line over the top,
 * because a man who announces that a song made him want to dance has ruined it.
 *
 * Matched against BOTH halves of the exchange. He is as entitled to be set off
 * by his own answer as by the question — more, probably, since the thing he
 * chose to bring up is the thing he is thinking about.
 */
const REACTIONS: { move: string; match: RegExp; chance: number; seconds?: number }[] = [
  { move: 'dance', match: /\b(song|songs|music|album|band|beat|track|tune|playlist|dj|concert|gig|spotify|banger|chorus|remix|vinyl|record|guitar|drums|bass line|melody)\b/, chance: 0.55, seconds: 6 },
  { move: 'dance', match: /\b(party|parties|club|clubbing|rave|celebrat\w*|birthday|new year|wedding|festival|friday night|dance floor)\b/, chance: 0.5, seconds: 6 },
  { move: 'hiphop', match: /\b(hip ?hop|rap|rapper|beatbox|breakdanc\w*|street)\b/, chance: 0.5, seconds: 6 },
  { move: 'run', match: /\b(run\w*|marathon|gym|workout|training|race|sprint\w*|exercise|football|basketball|soccer|tennis|cardio|treadmill|fitness|sports?)\b/, chance: 0.45, seconds: 4 },
  { move: 'backflip', match: /\b(stunt\w*|gymnast\w*|parkour|skateboard\w*|trick|circus|acrobat\w*|trampoline)\b/, chance: 0.5 },
  { move: 'tired', match: /\b(tired|exhaust\w*|knackered|long day|no sleep|insomnia|monday|overtime|deadline|burn\w* out)\b/, chance: 0.4, seconds: 5 },
  { move: 'sulk', match: /\b(gutted|miserable|depress\w*|awful|terrible|the worst|rubbish|went badly|fell through|rejected)\b/, chance: 0.35, seconds: 5 },
  { move: 'wave', match: /\b(goodbye|bye|see you|see ya|later|so long|farewell|nice to meet|good to meet)\b/, chance: 0.5 },
  { move: 'kneel', match: /\b(beg\w*|marry|proposal|propose|pray\w*|worship|on my knees)\b/, chance: 0.4, seconds: 4 },
  { move: 'tiptoe', match: /\b(quiet|shh+|secret|sneak\w*|whisper\w*|asleep|tip ?toe|burglar|ninja)\b/, chance: 0.35, seconds: 5 },
  { move: 'swagger', match: /\b(fashion|outfit|jacket|clothes|style|catwalk|photoshoot|looking good)\b/, chance: 0.3, seconds: 5 },
  { move: 'twerk', match: /\b(beyonc\w*|shakira|booty|twerk\w*)\b/, chance: 0.5, seconds: 5 },
  { move: 'wiggle', match: /\b(nervous|impatient|fidget\w*|can't sit|cant sit|antsy|restless)\b/, chance: 0.35, seconds: 5 },
];

const STOP = /\b(stop|stand still|stay still|stand there|quit it|pack it in|knock it off|cut it out|enough|that's enough|behave|be normal|be still|calm down|relax|freeze)\b/;
const AGAIN = /\b(again|one more|do that again|encore|repeat that|once more|another one)\b/;
const REPERTOIRE = /\b(what can you do|what else can you do|what have you got|what are your moves|what moves|repertoire|show me what you|list your|anything else)\b/;

/**
 * Whether a sentence is an order rather than a remark about one.
 *
 * "Can you dance" is an order — answering it by dancing is the only funny
 * answer. "Do you like dancing" is not, and "I can dance too" is very much not:
 * intercepting either of those would take a conversation away from the model
 * and replace it with a moonwalk. So a sentence has to either be short enough
 * to be a bare instruction, or carry one of the words people put in front of
 * one, and it must not be about the person saying it.
 */
const ASKING = /\b(can|could|would|will|please|show|give|let|do|does|go on|i want|i'd like|time to|how about|what about|try|make|start|begin|now)\b/;
const NOT_HIM = /\b(i|we|they|she|he|it) (can|could|will|would|should|used to|want\w*|like\w*|love\w*|hate\w*|enjoy\w*|prefer\w*|tr(y|ies|ied)|am|is|are|was|were|do|does|did|has|have|had|go|goes|went)\b|\bdo you (like|know|think|remember|ever|enjoy|hate|mind|prefer)\b|\b(my|his|her|their|your) \w+ (can|is|was|does|did|used)\b/;

const normalize = (text: string) => String(text || '')
  .toLowerCase()
  .replace(/[’`]/g, "'")
  .replace(/[^a-z0-9' ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const isOrder = (t: string) => {
  if (NOT_HIM.test(t)) return false;
  return t.split(' ').length <= 4 || ASKING.test(t);
};

/**
 * What he says while he does it.
 *
 * THE POINT OF THESE IS THAT HE IS NOT IMPRESSED. He was asked to do a thing
 * he can obviously do, by somebody who apparently doubted it, and the reply is
 * the reply anybody gives to that. Narration is banned — "like this", "here you
 * go", "watch me" — because the move is already happening on screen and saying
 * it out loud is the exact thing that was wrong before.
 */
const YEAH = [
  'Obviously.',
  'No duh.',
  'Yeah, I’m not an idiot.',
  'Of course.',
  'Duh.',
  'What, you thought I couldn’t?',
  'Was that meant to be difficult?',
  'Please.',
  'Fine. Once.',
  'You could have asked nicely.',
  'Sure. Had nothing on.',
  'Bold of you to ask. Correct, though.',
  'Yeah, alright.',
  'Obviously I can. Come on.',
  'Try to contain yourself.',
  'This is the easy one.',
];

/** Asked for something the export has no clip for. He does not admit that —
 *  he gets out of it, which is both funnier and what a person does. */
const NOPE = [
  'I did. You blinked.',
  'Did one this morning. Pulled something.',
  'Not in this room. Insurance.',
  'Ask again when there’s a mat down.',
  'I could. I’m choosing not to.',
  'That’s a two-person job.',
  'Last time I tried that, the ceiling won.',
  'Absolutely. Close your eyes first.',
  'No.',
  'Physically capable. Emotionally, no.',
  'Give me a week and a stunt double.',
  'That one’s not in the budget.',
];

const FINE = [
  'Fine.',
  'Rude.',
  'Suit yourself.',
  'Alright, alright.',
  'Happy now?',
  'And we were doing so well.',
  'Sure. Back to standing about.',
];

const WALKING = [
  'Fine. Stretching my legs.',
  'On it.',
  'Yeah, alright.',
  'Going. Going.',
];

/** Never the same line twice running, per bank. The greetings do this too, and
 *  for the same reason: a repeat is the one thing that gives the trick away. */
const pick = (() => {
  const last = new Map<string[], string>();
  return (bank: string[]) => {
    if (!bank.length) return '';
    if (bank.length < 2) return bank[0];
    const before = last.get(bank);
    let line = before;
    for (let i = 0; i < 8 && line === before; i++) line = bank[Math.floor(Math.random() * bank.length)];
    last.set(bank, line!);
    return line!;
  };
})();

/** A move's own lines half the time, the general bank the rest. Always its own
 *  when it has them and the move is unusual enough to deserve the specific
 *  joke — twerking does not want "obviously" every time. */
const lineFor = (move: Move) => (move.quips?.length && Math.random() < 0.55 ? pick(move.quips) : pick(YEAH));

const COUNT = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

export function createCommands(craft: Stagecraft): Commands {
  /* Resolved once, against the clips this export actually shipped. A move with
     an empty list is one he cannot do — kept in the table rather than removed,
     because that is what makes the dodge possible. */
  const found = new Map<string, string[]>();
  for (const move of MOVES) {
    const hit: string[] = [];
    for (const pattern of move.want) {
      const clips = craft.clips.filter((c) => pattern.test(c));
      if (clips.length) { hit.push(...clips); break; }
    }
    found.set(move.id, hit);
  }

  const able = MOVES.filter((m) => found.get(m.id)!.length);

  const perform = (move: Move): Command => {
    const clips = found.get(move.id)!;
    if (!clips.length) {
      return {
        id: move.id,
        quip: pick(NOPE),
        dodged: true,
        attend: true,
        run: () => { /* nothing to run, which is the joke */ },
      };
    }
    return {
      id: move.id,
      quip: lineFor(move),
      dodged: false,
      attend: true,
      // Random among the matches, so "dance" is a different one each time
      // without six buttons having to exist for it.
      run: () => { craft.poses.perform(clips[Math.floor(Math.random() * clips.length)], move.seconds); },
    };
  };

  /** What is actually in the file, said out loud. This exists because the
   *  question "what animations did I put in this one" is a real question with a
   *  real answer, and the answer lives in the GLB rather than in anybody's
   *  memory. */
  const repertoire = () => {
    const dances = able.filter((m) => m.dance && !m.hidden).map((m) => m.say);
    const rest = able.filter((m) => !m.dance && !m.hidden).map((m) => m.say);
    const bits: string[] = [];
    if (dances.length) bits.push(`${COUNT[dances.length] ?? dances.length} dances — ${dances.join(', ')}`);
    if (rest.length) bits.push(`${rest.join(', ')}`);
    if (!bits.length) return 'Standing here. That’s the entire act.';
    const said = bits.join('. Then ');
    return `${said.charAt(0).toUpperCase()}${said.slice(1)}. Ask for a backflip and find out what happens.`;
  };

  const byId = new Map(MOVES.map((m) => [m.id, m]));

  /** Everything a subject suggested, so the choice is among all of them rather
   *  than whichever happens to be listed first. */
  const suggest = (heard: string, reply: string): Command | null => {
    const t = `${normalize(heard)} ${normalize(reply)}`;
    if (!t.trim()) return null;
    const hits = REACTIONS.filter((r) => r.match.test(t) && found.get(r.move)?.length);
    if (!hits.length) return null;
    const chosen = hits[Math.floor(Math.random() * hits.length)];
    if (Math.random() > chosen.chance) return null;
    const move = byId.get(chosen.move)!;
    const clips = found.get(move.id)!;
    return {
      id: move.id,
      // Nothing is said over it. He did not offer, he was not asked, and
      // announcing it is the difference between a person and a demonstration.
      quip: '',
      dodged: false,
      attend: false,
      run: () => { craft.poses.perform(clips[Math.floor(Math.random() * clips.length)], chosen.seconds ?? move.seconds); },
    };
  };

  let last: Move | null = null;

  const match = (heard: string): Command | null => {
    const t = normalize(heard);
    if (!t) return null;

    if (REPERTOIRE.test(t)) {
      return { id: 'repertoire', quip: repertoire(), dodged: false, attend: true, run: () => {} };
    }

    if (STOP.test(t)) {
      last = null;
      return {
        id: 'stop',
        quip: pick(FINE),
        dodged: false,
        attend: true,
        run: () => { craft.poses.release(); craft.wander.halt(); },
      };
    }

    if (AGAIN.test(t) && last) return perform(last);

    if (!isOrder(t)) return null;

    for (const go of GO) {
      if (!go.match.test(t)) continue;
      /* A backdrop is one room he must not stroll out of, so in a studio this
         becomes a refusal rather than him walking off the edge of the world. */
      if (!craft.canWalk()) return { id: go.id, quip: pick(NOPE), dodged: true, attend: true, run: () => {} };
      last = null;
      return {
        id: go.id,
        quip: pick(WALKING),
        dodged: false,
        // He is being sent somewhere; holding his face to the lens while he
        // goes is the one thing that would stop him getting there.
        attend: false,
        run: () => {
          craft.poses.release();
          craft.wander.config.enabled = true;
          craft.wander.stroll(go.prefer);
        },
      };
    }

    for (const move of MOVES) {
      if (!move.match.test(t)) continue;
      const command = perform(move);
      // "Do it again" only means something after something he could do.
      last = command.dodged ? null : move;
      return command;
    }
    return null;
  };

  return { match, suggest, get able() { return able.map((m) => m.id); } };
}
