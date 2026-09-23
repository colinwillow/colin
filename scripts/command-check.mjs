// Does he do what he is told, and does he leave conversations alone?
//
// Two things are under test and the second one is the dangerous one:
//
//   1. An order starts a clip. "Do a dance" has to move him on the frame the
//      sentence lands, and hand him back when it has run.
//   2. A REMARK IS NOT AN ORDER. The matcher sits in front of the model, so
//      every false positive is a conversation replaced by a moonwalk — and
//      "do you like dancing" is one word away from "do a dance". The rejection
//      table below is the more important half of this file.
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/command-check.mjs http://127.0.0.1:4173/
//
// Playwright is not a project dependency: npm i -D playwright first.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const CHROME = process.env.CHROME_PATH
  || (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio',
    '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => { console.log('  PAGE ERROR:', e.message); fail('page error'); });
page.on('console', (m) => { if (/^commands —/.test(m.text())) console.log(' ', m.text()); });

// No Worker. An order is meant to be answered without one, and the model must
// never be asked about one — so any call to the brain here is a failure.
await page.addInitScript(() => {
  const real = window.fetch.bind(window);
  window.__asked = [];
  window.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input.url ?? String(input);
    if (!/workers\.dev/.test(href)) return real(input, init);
    if (/\/speak$/.test(href)) return new Response('no', { status: 503 });
    window.__asked.push(JSON.parse(init.body).messages.at(-1)?.content ?? '');
    return new Response('…', { headers: { 'content-type': 'text/plain' } });
  };
});

let bad = 0;
const fail = (why) => { console.log('  FAIL:', why); bad++; };
const want = (got, expected, what) => {
  if (got === expected) console.log(`  ok   ${what} → ${got}`);
  else fail(`${what} → ${got}, wanted ${expected}`);
};

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.talk && window.poses, null, { timeout: 180000 });
// Software WebGL draws a frame every second or so and blocks the thread doing
// it. Nothing below is about pixels, and the performance clock is stepped by
// hand, so the loop is only in the way.
await page.evaluate(() => window.renderer.setAnimationLoop(null));

const able = await page.evaluate(() => window.talk.commands.able);
console.log(`\nmoves this export supports: ${able.join(', ')}\n`);

/** What each phrase should match. null means "leave it to the model". */
const TABLE = [
  // Orders, in the shapes people actually use.
  ['do a dance', 'dance'],
  ['dance', 'dance'],
  ['can you dance', 'dance'],
  ['show me the moonwalk', 'moonwalk'],
  ['moonwalk', 'moonwalk'],
  ['bust a move', 'dance'],
  ['do some hip hop', 'hiphop'],
  ['wave at me', 'wave'],
  ['say hello', 'wave'],
  ['please kneel', 'kneel'],
  ['sit down', 'kneel'],
  ['look tired', 'tired'],
  ['sulk', 'sulk'],
  ['strut', 'swagger'],
  ['sneak around', 'tiptoe'],
  ['run', 'run'],
  // Things the export has no clip for. Matched on purpose, so the answer has a
  // joke in it rather than a paragraph from the model.
  ['do a backflip', 'backflip'],
  ['can you do a cartwheel', 'cartwheel'],
  ['give me twenty push ups', 'pushup'],
  ['jump', 'jump'],
  ['turn around', 'spin'],
  // Moving, which is the wander's job rather than a clip's.
  ['come here', 'closer'],
  ['back up', 'back'],
  ['walk around', 'walk'],
  // Housekeeping.
  ['stop', 'stop'],
  ['stand still', 'stop'],
  ['what can you do', 'repertoire'],
  // AND EVERYTHING THAT IS NOT AN ORDER. Each of these is a conversation the
  // matcher would have eaten.
  ['do you like dancing', null],
  ['i can dance too', null],
  ['my sister does hip hop', null],
  ['i used to run every morning', null],
  ['what do you think about dancing', null],
  ['she loves to dance', null],
  ['he does hip hop', null],
  ['your dog can dance', null],
  ['have you ever been to a dance', null],
  ['where did you learn to dance like that', null],
  ['tell me about your dog', null],
  ['what is your favourite food', null],
  ['how are you doing today', null],
  ['it is raining outside', null],
];

console.log('matching:');
for (const [phrase, expected] of TABLE) {
  const got = await page.evaluate((p) => window.talk.commands.match(p)?.id ?? null, phrase);
  want(got, expected, `"${phrase}"`);
}

/* A quip is not a narration. The whole reason this layer exists is that the
   model answered "like this" over a man standing still, so a line that
   describes the move instead of being smug about it is the bug coming back. */
console.log('\nlines:');
const lines = await page.evaluate(() => {
  const out = [];
  for (let i = 0; i < 40; i++) out.push(window.talk.commands.match('do a dance').quip);
  for (let i = 0; i < 40; i++) out.push(window.talk.commands.match('do a backflip').quip);
  return out;
});
const narrating = lines.filter((l) => /\b(like this|here you go|watch me|here i go|i will now|coming up)\b/i.test(l));
want(narrating.length, 0, 'lines that narrate the move');
const repeats = lines.filter((l, i) => i && l === lines[i - 1] && lines[i - 1] !== lines[i - 2]);
want(repeats.length, 0, 'the same line twice running');
console.log(`  ${new Set(lines).size} distinct lines over 80 draws`);

/* Printed rather than asserted: what he actually says is a judgement call, and
   the only way to make it is to read it. */
console.log('\nwhat he says:');
const sample = await page.evaluate(() => ['what can you do', 'do a dance', 'twerk', 'do a backflip',
  'turn around', 'look tired', 'wave', 'stop'].map((p) => {
  const c = window.talk.commands.match(p);
  return `  ${p.padEnd(16)} ${c.dodged ? '(dodge) ' : ''}${c.quip}`;
}));
for (const line of sample) console.log(line);

/* A studio backdrop has no floor to cross, so being sent anywhere has to become
   a refusal rather than him walking off the edge of the world. It is the room
   the app opens in, which is why this runs before the kitchen below. */
console.log('\nin a room with no floor:');
const studio = await page.evaluate(() => ({
  scene: window.stage.current.id,
  wander: window.stage.current.wander,
  here: window.talk.commands.match('come here').dodged,
  dance: window.talk.commands.match('do a dance').dodged,
}));
want(studio.wander, false, `"${studio.scene}" has nowhere to walk`);
want(studio.here, true, '"come here" is a dodge there');
want(studio.dance, false, 'but he will still dance');

console.log('\ndoing it:');
// The kitchen, because the handover at the end of a dance is a handover TO the
// wander and there is no wander in a studio.
await page.evaluate(async () => { window.stage.go('kitchen', true); });
await page.waitForTimeout(500);
await page.evaluate(() => window.talk.voice.arm());
const run = await page.evaluate(async () => {
  const seen = [];
  window.talk.say('do a dance');
  // Stepped by hand: the render loop is off, and the performance is counted
  // down from it.
  for (let i = 0; i < 300; i++) {
    await new Promise((r) => setTimeout(r, 10));
    window.poses.update(0.05);
    seen.push({ at: i * 0.05, clip: window.poses.clip, wander: window.wander.config.enabled });
  }
  return {
    started: seen[0].clip,
    // The clip has to survive the end of the sentence — he answers in about a
    // second and the dance runs for eight.
    atTwo: seen.find((s) => s.at >= 2)?.clip ?? null,
    wanderAtTwo: seen.find((s) => s.at >= 2)?.wander ?? null,
    atEnd: seen.at(-1).clip,
    wanderAtEnd: seen.at(-1).wander,
    asked: window.__asked.slice(),
    transcript: window.talk.brain.log.slice(-2),
  };
});
want(/^dance/.test(String(run.started)), true, 'a dance clip started on the same tick');
want(/^dance/.test(String(run.atTwo)), true, 'still dancing two seconds in');
want(run.wanderAtTwo, false, 'the wander stays off while he dances');
want(run.atEnd, null, 'handed back when the clip had run');
want(run.wanderAtEnd, true, 'and the wander has him again');
want(run.asked.length, 0, 'questions put to the model');
want(run.transcript.length, 2, 'turns added to the transcript');
console.log(`  transcript: ${run.transcript.map((t) => `${t.role}: ${t.content}`).join(' | ')}`);

console.log('\nand stopping:');
const stopped = await page.evaluate(async () => {
  window.talk.say('do some hip hop');
  await new Promise((r) => setTimeout(r, 60));
  const during = window.poses.clip;
  window.talk.say('stop');
  await new Promise((r) => setTimeout(r, 60));
  return { during, after: window.poses.clip, wander: window.wander.config.enabled };
});
want(/hiphop/.test(String(stopped.during)), true, 'hip-hop started');
want(stopped.after, null, '"stop" put him back');

await browser.close();
console.log(bad ? `\n${bad} problem(s)` : '\nall good');
process.exitCode = bad ? 1 : 0;
