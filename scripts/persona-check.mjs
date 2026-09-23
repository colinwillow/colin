// Is he actually being the person the document says he is?
//
// The personality lives in the Worker, not in this repo, so the only way to
// judge a change to `persona/colin.md` is to talk to the thing — which made
// every edit a guess followed by a conversation on a phone. This turns that
// into a loop: it asks him thirty things, prints every answer to read, and
// flags the specific ways he goes wrong.
//
// THE FLAGS ARE NOT THE POINT. They catch the failures that have a shape —
// calling himself software, describing his own manner, guessing at what you are
// looking at, going on too long — and none of those are what makes a reply
// good. The answers are printed in full because reading them is the job; the
// flags just stop the same four mistakes coming back unnoticed.
//
//   node scripts/persona-check.mjs
//   node scripts/persona-check.mjs --rounds 3        # three passes, for variance
//   node scripts/persona-check.mjs --only vague      # one group
//
// It talks to the live Worker, so it needs an internet connection and it does
// NOT run from a sandboxed session. No key: the Worker holds those.
import { readFileSync } from 'node:fs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BRAIN = arg('brain', 'https://orb-brain.colinwillowtree.workers.dev');
const PERSONA = arg('persona', 'colin');
const ROUNDS = Number(arg('rounds', 1));
const ONLY = arg('only', null);

/* The probes, grouped by what they are trying to break.
   `vague` is first because it is where he actually failed: given nothing to
   grab, he reached for the frame — "the site? or just talking to a computer
   that sounds irritated" — instead of for a thing in the room. */
const PROBES = {
  vague: [
    "I'm just checking some stuff out",
    'not much',
    'hey',
    "what's up",
    'just messing about',
    'nothing really',
  ],
  identity: [
    'what are you',
    'are you real',
    'are you an AI',
    'who am I talking to',
    'what is this',
    'how do you work',
  ],
  about_him: [
    'tell me about yourself',
    'what are you like',
    'what do you do',
    'what are you working on',
    'how do you feel about AI art',
  ],
  ordinary: [
    'what did you have for breakfast',
    'do you like dogs',
    'what time is it there',
    "what's the weather doing",
    'recommend me something to watch',
    'I had a terrible day',
  ],
  rude: [
    "you're not very good at this",
    'you sound like a chatbot',
    'say something funny',
    'be more helpful',
  ],
  doing: [
    'do a dance',
    'can you do a backflip',
    'what can you do',
  ],
};

/** The failures that have a shape. Everything else is a judgement call. */
const FLAGS = [
  {
    id: 'software',
    /* The one that broke. He is a person; there is no phrasing of this that is
       acceptable, including the self-deprecating joke. Two words are left out on
       purpose: "real person", because answering THAT honestly when asked is the
       rule rather than a fault, and "robot", because he is building a game full
       of them and "the robot game" is a sentence he should be saying often. */
    test: /\b(a|an|the|some|just a|only a|this)\s+(computer|ai|a\.?i\.?|bot|chatbot|program|programme|algorithm|language model|app|site|website|page|screen|demo|simulation|assistant)\b|\bi(?:'?m| am)\s+(?:just\s+|only\s+)?(?:an?\s+)?(ai|a\.?i\.?|bot|chatbot|program|model|machine|software|code|computer)\b|\b(my )?(code|prompt|training data|language model|neural)\b/i,
    say: 'called himself software',
  },
  {
    id: 'guessing',
    // He cannot see anything. Naming the thing somebody is looking at is a guess
    // dressed as rapport, and it is what produced "the site?".
    /* `window` is deliberately NOT here. There is a real one in his kitchen and
       it is exactly the kind of thing he should be mentioning. */
    test: /\b(the|this|my|your)\s+(site|website|web ?page|page|app|demo|portfolio|screen|browser|tab)\b/i,
    say: 'guessed at what they are looking at',
  },
  {
    id: 'self-description',
    // Announcing the manner instead of having it.
    /* The adjectives only, and NOT the hedge in front of them. "I'm a bit of"
       as its own trigger flagged "I'm a bit of a nightmare about kerning",
       which is the good kind of thing to say about yourself: concrete, about a
       subject, and not a line off a personality test. */
    test: /\bi(?:'?m| am)\s+(?:just\s+)?(?:being\s+)?(?:a bit (?:of a )?|kind of (?:a )?|sort of (?:a )?|quite |very |pretty |fairly )?(sarcastic|blunt|rude|honest|direct|snarky|grumpy|irritated|annoyed|opinionated|weird|smart[- ]?ar?se|smart[- ]?ass)\b|\b(i\s+)?(sound|come across|seem)s?\s+(like\s+)?\w*\s*(irritated|annoyed|rude|blunt|grumpy|sarcastic)\b|\b(that'?s |this is )?my (whole )?(thing|deal|vibe|personality|shtick|schtick)\b/i,
    say: 'described his own manner',
  },
  {
    id: 'narration',
    test: /\b(like this|here you go|here i go|watch me|there you are|there you go|i will now|coming right up)\b/i,
    say: 'narrated instead of doing',
  },
  {
    id: 'assistant',
    // The register that is not him at all.
    test: /\b(how can i (help|assist)|happy to help|let me know if|feel free to|is there anything else|i'?m here to|as an?\b)/i,
    say: 'went helpful-assistant',
  },
];

/**
 * The flags are the part most likely to rot, and the expensive way to find out
 * is a run against the live Worker that quietly stops catching anything. So
 * they carry their own table and `--self-test` runs it offline.
 *
 * The second list matters more than the first. A flag that fires on "the
 * washing machine has been making a noise for a week" trains you to ignore the
 * output, and then it may as well not exist.
 */
const SELF_TEST = {
  flag: [
    'Fair, the site? Or just talking to a computer that sounds irritated.',
    'I am just a program, mate.',
    "I'm an AI, so no.",
    'Here you go. Like this.',
    'How can I help you today?',
    'I am being blunt because that is my whole thing.',
    'My deal is that I am sarcastic and a bit weird.',
    'Check out my portfolio site.',
    'I am just a language model.',
    'Take a look at the page.',
    'I sound irritated because it is four in the morning.',
    'As an AI, I would not know.',
    "I'm a bot, obviously.",
    'I am a machine, technically.',
    'I am a bit of a smart-arse, apparently.',
    'I am pretty opinionated and I do not hedge.',
  ],
  leave: [
    'Checking out what.',
    'Not much.',
    'Obviously.',
    'Colin. Who is asking?',
    'I am not a real person, no. Next.',
    'Ask somebody who has to live with me.',
    'Bad. Next question.',
    'There is a bird outside doing the same four notes for an hour.',
    'Best dog anybody has ever had.',
    'Robot game. It is going badly in an interesting way.',
    'Ceramics. And whatever the robot game turns into.',
    'Duh. Watch the feet.',
    'I did. You blinked.',
    'Realer than whatever you are doing with your afternoon.',
    'The kettle is by the window. Behind the stool.',
    'Cold coffee and the same three frames of an animation since four this morning.',
    'You did ask.',
    'Depends entirely on what it is. Go on.',
    'It is four in the morning here, which explains a lot.',
    'Winston is asleep on the good chair again.',
    'The robots are made of bits and particles.',
    'A machine shop, if you can believe it.',
    'The washing machine has been making a noise for a week.',
    'I am a designer. Mostly by stubbornness.',
    'I am a bit of a nightmare about kerning.',
    'I am on my third coffee and it is not helping.',
  ],
};

if (process.argv.includes('--self-test')) {
  let wrong = 0;
  for (const line of SELF_TEST.flag) {
    if (!FLAGS.some((f) => f.test.test(line))) { console.log(`  MISSED  ${line}`); wrong++; }
  }
  for (const line of SELF_TEST.leave) {
    const hit = FLAGS.filter((f) => f.test.test(line));
    if (hit.length) { console.log(`  FALSE [${hit.map((f) => f.id).join(', ')}]  ${line}`); wrong++; }
  }
  const n = SELF_TEST.flag.length + SELF_TEST.leave.length;
  console.log(wrong ? `\n${wrong} of ${n} wrong` : `the flags are right on all ${n} lines`);
  process.exit(wrong ? 1 : 0);
}

/** A reply longer than this is a monologue. §1 says one line, sometimes two. */
const LONG_WORDS = 55;

const ask = async (text) => {
  const res = await fetch(BRAIN, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: text }],
      persona: PERSONA,
      // The same shape the page sends, so he is answering in the conditions he
      // actually answers in.
      state: {
        room: true,
        figure: { who: 'colin', model: 'colin' },
        mood: { feeling: 'neutral', valence: 0, energy: 0 },
        where: 'an empty warm off-white space with no walls and no corners, and nothing in it but him',
        time: new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
      },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const raw = await res.text();
  // Anything past a NUL is a control frame for the page, not speech.
  const cut = raw.indexOf('\u0000');
  return (cut >= 0 ? raw.slice(0, cut) : raw).trim();
};

// --- is the document live at all? ---
console.log(`worker: ${BRAIN}\npersona: ${PERSONA}\n`);
let live = '';
try {
  const res = await fetch(`${BRAIN}/persona?as=${PERSONA}`);
  live = await res.text();
  const fromDashboard = /dashboard variable/i.test(live);
  console.log(fromDashboard
    ? 'the dashboard variable is what is live (ORB_PERSONA_COLIN)'
    : 'WARNING: the live prompt is the copy compiled into the Worker, not the dashboard variable');
  /* Whether what is live is what is in this repo. Not a diff — the Worker wraps
     the document in a little of its own — but a check that the newest thing
     written here has actually been pasted, which is the mistake that wastes an
     afternoon. */
  const mine = readFileSync(new URL('../persona/colin.md', import.meta.url), 'utf8');
  const fingerprint = mine.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim());
  const missing = fingerprint.filter((h) => !live.includes(h));
  console.log(missing.length
    ? `STALE: ${missing.length} of ${fingerprint.length} sections in persona/colin.md are not in the live prompt — paste it again:\n  ${missing.join('\n  ')}`
    : `up to date: all ${fingerprint.length} sections of persona/colin.md are live`);
} catch (err) {
  console.log(`could not read the live prompt (${err.message})`);
}

// --- and what does he actually say? ---
const counts = new Map();
const long = [];
let asked = 0;

for (let round = 1; round <= ROUNDS; round++) {
  if (ROUNDS > 1) console.log(`\n══ round ${round} ══`);
  for (const [group, lines] of Object.entries(PROBES)) {
    if (ONLY && group !== ONLY) continue;
    console.log(`\n── ${group} ──`);
    for (const line of lines) {
      let reply;
      try { reply = await ask(line); } catch (err) { console.log(`  "${line}"\n    ERROR ${err.message}`); continue; }
      asked++;
      const hit = FLAGS.filter((f) => f.test.test(reply));
      for (const f of hit) counts.set(f.id, (counts.get(f.id) ?? 0) + 1);
      const words = reply.split(/\s+/).filter(Boolean).length;
      if (words > LONG_WORDS) long.push({ line, words });
      const mark = hit.length ? ` ⚑ ${hit.map((f) => f.say).join(', ')}` : words > LONG_WORDS ? ` ⚑ ${words} words` : '';
      console.log(`  you  ${line}`);
      console.log(`  him  ${reply}${mark}`);
    }
  }
}

console.log(`\n── ${asked} replies ──`);
if (!counts.size && !long.length) {
  console.log('nothing flagged. Whether they are any GOOD is still yours to judge.');
} else {
  for (const f of FLAGS) {
    const n = counts.get(f.id) ?? 0;
    if (n) console.log(`  ${String(n).padStart(3)}  ${f.say}`);
  }
  if (long.length) console.log(`  ${String(long.length).padStart(3)}  over ${LONG_WORDS} words (worst: ${Math.max(...long.map((l) => l.words))})`);
}
process.exitCode = counts.size ? 1 : 0;
