// Does he actually read the thing, and does his mouth follow it?
//
// Two halves. The first runs `align-narration.mjs` over a made-up recording and
// checks what it writes, which needs nothing but node. The second builds a
// four-part reading into the served folder, plays it in a real browser, and
// watches: the position advances on the clock, the mouth moves, a pause holds
// where it was, a resume carries on from there, a seek lands, and the seam
// between parts passes without the audio stopping.
//
// THE SEAM AND THE PAUSE ARE THE POINT. Everything else would survive a much
// simpler player; those two are the reason the audio is in parts and the reason
// `place` learned to start a buffer some way in.
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/narration-check.mjs http://127.0.0.1:4173/
//
// Playwright is not a project dependency: npm i -D playwright first.
import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const CHROME = process.env.CHROME_PATH
  || (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);

let bad = 0;
const fail = (why) => { console.log('  FAIL:', why); bad++; };
const ok = (yes, what) => { if (yes) console.log(`  ok   ${what}`); else fail(what); };

/** A loud tone, so the mouth's level gate opens on it. */
const tone = (seconds) => {
  const rate = 24000, n = Math.round(rate * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 18) * 20000), 44 + i * 2);
  return buf;
};

// ─── 1. the aligner, offline ───────────────────────────────────────────────
console.log('the aligner:');
const scratch = '.narration-check';
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });
writeFileSync(join(scratch, 'tone.wav'), tone(6));
/* Word timings in WhisperX's shape, with a real gap in the middle: the gap is
   what closes his mouth, and a run of characters with no space between them is
   the one thing that makes a face chew continuously. */
const WORDS = ['everything', 'is', 'only', 'in', 'your', 'mind', 'so', 'why', 'is', 'there', 'a', 'shared', 'one'];
writeFileSync(join(scratch, 'words.json'), JSON.stringify({
  segments: [{
    /* Spaced to finish inside the six seconds of audio, with one wider gap in
       the middle. A word timed past the end is clipped away, which is correct
       and makes for a confusing test. */
    words: WORDS.map((word, i) => ({
      word,
      start: i * 0.38 + (i > 5 ? 0.5 : 0),
      end: i * 0.38 + 0.3 + (i > 5 ? 0.5 : 0),
    })),
  }],
}));
execFileSync('node', ['scripts/align-narration.mjs', join(scratch, 'tone.wav'),
  '--words', join(scratch, 'words.json'), '--out', scratch, '--id', 'aligned',
  '--title', 'An Aligned Reading', '--duration', '6'], { stdio: 'pipe' });

const aligned = JSON.parse(readFileSync(join(scratch, 'aligned.json'), 'utf8'));
ok(aligned.parts?.length >= 1, 'it wrote a manifest with at least one part');
ok(aligned.voice === 'Colin, recorded', 'and credited the recording rather than the engine');
const m = aligned.parts[0].marks;
ok(!!m && m.characters.length > 30, `${m?.characters.length ?? 0} character timings from ${WORDS.length} words`);
const starts = m.character_start_times_seconds;
ok(starts.every((t, i) => i === 0 || t >= starts[i - 1] - 1e-6), 'the times only ever go forwards');
ok(m.characters.filter((c) => c === ' ').length >= WORDS.length - 1, 'there is a space between every pair of words');
ok(Math.max(...m.character_end_times_seconds) <= aligned.duration + 0.01, 'nothing is timed past the end of the audio');
const index = JSON.parse(readFileSync(join(scratch, 'index.json'), 'utf8'));
ok(index.some((r) => r.id === 'aligned'), 'and it put itself in the index');

// ─── 2. a reading, in a browser ────────────────────────────────────────────
/* Written into `dist` rather than `public` so nothing has to be rebuilt and
   nothing is left in the repo. Four parts of three seconds: enough to cross a
   seam twice and short enough to watch. */
const PARTS = 4;
const PART_SECS = 3;
const served = 'dist/narration';
rmSync(served, { recursive: true, force: true });
mkdirSync(join(served, 'check'), { recursive: true });
const letters = 'hello there this is the part being read out loud'.split(' ');
const manifest = {
  id: 'check', title: 'A Reading Under Test', voice: 'a test tone',
  words: PARTS * letters.length, duration: PARTS * PART_SECS,
  parts: [],
};
for (let p = 0; p < PARTS; p++) {
  const name = `check/${String(p + 1).padStart(3, '0')}.wav`;
  writeFileSync(join('dist/narration', name), tone(PART_SECS));
  const characters = [], s = [], e = [];
  let t = 0;
  for (const word of letters) {
    for (const c of word) { characters.push(c); s.push(t); e.push(t + 0.05); t += 0.05; }
    characters.push(' '); s.push(t); e.push(t + 0.06); t += 0.06;
  }
  // Stretched to fill the part exactly, so the last character ends with it.
  const k = (PART_SECS - 0.05) / t;
  manifest.parts.push({
    audio: name, text: letters.join(' '), duration: PART_SECS,
    marks: {
      characters,
      character_start_times_seconds: s.map((v) => +(v * k).toFixed(3)),
      character_end_times_seconds: e.map((v) => +(v * k).toFixed(3)),
    },
  });
}
writeFileSync(join(served, 'check.json'), JSON.stringify(manifest));
writeFileSync(join(served, 'index.json'), JSON.stringify([
  { id: 'check', title: manifest.title, duration: manifest.duration, voice: manifest.voice, words: manifest.words },
]));

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio',
    '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => { console.log('  PAGE ERROR:', e.message); bad++; });
if (process.env.VERBOSE) page.on('console', (mm) => console.log('   page:', mm.text().slice(0, 160)));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.narration && window.talk, null, { timeout: 180000 });
// Software WebGL draws about one frame a second and blocks the thread doing it,
// which would starve the sampler below. The face is stepped by hand instead.
await page.evaluate(() => window.renderer.setAnimationLoop(null));
await page.evaluate(() => {
  window.headMesh = window.face.meshes.find((mm) => 'Colin_Head_MIX' in mm.morphTargetDictionary);
  window.step = (dt) => {
    window.face.beginFrame();
    window.talk.update(dt);
    window.alive.update(dt, window.face);
    window.face.commit();
  };
});

/* The kitchen, because two of the assertions below are about him being held
   still and then let go — and a studio backdrop has no floor to walk on, so
   there the wander is off either way and both would pass without meaning
   anything. */
await page.evaluate(() => window.stage.go('kitchen', true));
await page.waitForTimeout(400);
ok(await page.evaluate(() => window.stage.current.wander), 'he is somewhere with a floor, so holding him means something');

console.log('\nthe reading:');
const found = await page.evaluate(() => window.narration.load().then((r) => r.map((x) => x.title)));
ok(found.includes('A Reading Under Test'), `the index was read: ${found.join(', ') || 'nothing'}`);

await page.evaluate(() => window.talk.voice.arm());
const run = await page.evaluate(async () => {
  const out = { shapes: new Set(), samples: [] };
  const started = await window.narration.play('check');
  const t0 = performance.now();
  for (let i = 0; i < 160; i++) {
    await new Promise((r) => setTimeout(r, 25));
    window.step(0.025);
    out.shapes.add(window.talk.voice.shape());
    if (i % 20 === 0) {
      out.samples.push({
        real: +((performance.now() - t0) / 1000).toFixed(2),
        at: +window.narration.at().toFixed(2),
        speaking: window.talk.voice.speaking,
      });
    }
  }
  return {
    started,
    shapes: [...out.shapes],
    samples: out.samples,
    wander: window.wander.config.enabled,
    at: window.narration.at(),
    speaking: window.talk.voice.speaking,
  };
});
ok(run.started, 'it started');
for (const s of run.samples) console.log(`    ${String(s.real).padStart(5)}s real · ${String(s.at).padStart(5)}s in · ${s.speaking ? 'talking' : 'silent'}`);
ok(run.shapes.filter((s) => s !== 'rest').length >= 3,
  `the mouth moved through ${run.shapes.filter((s) => s !== 'rest').length} shapes: ${run.shapes.join(' ')}`);
ok(run.wander === false, 'and he is not wandering off in the middle of it');
/* Past the first part and still going: the seam is the whole reason the audio
   is in parts, and a gap there would show up as `speaking` going false. */
ok(run.at > 3.2 && run.speaking, `past the first seam at ${run.at.toFixed(1)}s and still talking`);
const drift = Math.abs(run.samples.at(-1).at - run.samples.at(-1).real);
ok(drift < 0.5, `the position tracks real time to within ${drift.toFixed(2)}s`);

console.log('\npausing and coming back:');
const paused = await page.evaluate(async () => {
  window.narration.pause();
  const was = window.narration.at();
  const speakingWhilePaused = window.talk.voice.speaking;
  await new Promise((r) => setTimeout(r, 700));
  const still = window.narration.at();
  await window.narration.resume();
  await new Promise((r) => setTimeout(r, 500));
  return { was, speakingWhilePaused, still, after: window.narration.at(), wander: window.wander.config.enabled };
});
ok(!paused.speakingWhilePaused, 'a pause stops the audio');
ok(Math.abs(paused.still - paused.was) < 0.05, `and holds the position (${paused.was.toFixed(2)}s)`);
ok(paused.after >= paused.was - 0.1 && paused.after < paused.was + 1.5,
  `resuming carries on from there, not from the top (${paused.after.toFixed(2)}s)`);
ok(paused.wander === false, 'and he is still held while it plays');

console.log('\nseeking:');
const sought = await page.evaluate(async () => {
  await window.narration.seek(9);
  await new Promise((r) => setTimeout(r, 400));
  for (let i = 0; i < 12; i++) { await new Promise((r) => setTimeout(r, 25)); window.step(0.025); }
  return { at: window.narration.at(), speaking: window.talk.voice.speaking, shape: window.talk.voice.shape() };
});
ok(sought.at > 8.5 && sought.at < 11, `it landed at ${sought.at.toFixed(1)}s of 12`);
ok(sought.speaking, 'and is playing from there — in the last part, not the first');

console.log('\nstopping:');
const stopped = await page.evaluate(async () => {
  window.narration.stop();
  await new Promise((r) => setTimeout(r, 200));
  return { playing: window.narration.playing, reading: window.narration.reading, speaking: window.talk.voice.speaking, wander: window.wander.config.enabled };
});
ok(!stopped.playing && !stopped.reading, 'it stopped and let go of the reading');
ok(!stopped.speaking, 'the audio stopped with it');
ok(stopped.wander === true, 'and he has the floor back');

await browser.close();
rmSync(scratch, { recursive: true, force: true });
rmSync(served, { recursive: true, force: true });
console.log(bad ? `\n${bad} problem(s)` : '\nall good');
process.exitCode = bad ? 1 : 0;
