// Does he hear himself?
//
// He did. The symptom was him answering as though he were being repeated back
// at himself, and there were two causes: the meter's microphone stream asked
// for audio with the echo canceller OFF — which on a page with one audio
// session takes it off the speech recogniser too — and the timing gates around
// his own speech assumed recognition hands over an utterance promptly, which it
// does not.
//
// So there are two halves here, and the second matters more:
//
//   1. The stream asks for echo cancellation. One assertion, and it is the
//      difference between a hard problem and no problem.
//   2. HIS OWN WORDS ARE RECOGNISED AND DROPPED even when they arrive as
//      recognition mangled them, seconds after he stopped. That is the one that
//      holds on a browser whose canceller does not.
//
// And the risk that comes with the second: a filter in front of the model is a
// filter that can eat real speech. The rejection table is the important half of
// the important half.
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/echo-check.mjs http://127.0.0.1:4173/
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
    '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  deviceScaleFactor: 2, permissions: ['microphone'],
});

let bad = 0;
const fail = (why) => { console.log('  FAIL:', why); bad++; };
const ok = (yes, what) => { if (yes) console.log(`  ok   ${what}`); else fail(what); };
page.on('pageerror', (e) => { console.log('  PAGE ERROR:', e.message); bad++; });
if (process.env.VERBOSE) page.on('console', (m) => console.log('   page:', m.text().slice(0, 160)));

await page.addInitScript(() => {
  /* A recogniser the test drives by hand. Real speech recognition cannot be fed
     audio from here, and what is under test is what happens to a transcript
     once it arrives — so the transcript is the input. */
  window.__starts = 0;
  class FakeSR {
    constructor() { window.__rec = this; this.n = 0; }
    start() { window.__starts++; this.onstart?.(); }
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
  /* Hand the page a sentence the way recognition actually does in a room: as
     interim text that stops changing. `isFinal` waits for silence and a kitchen
     never goes silent, so the gap timer in listen.ts is the normal path and the
     final result is the exception — testing through the exception would miss
     the code that runs every time. */
  window.__heard = (text) => {
    const rec = window.__rec;
    const i = rec.n++;
    const results = { length: i + 1, [i]: { 0: { transcript: text }, isFinal: false } };
    rec.onresult?.({ resultIndex: i, results });
  };

  // What the meter's stream actually asked for.
  const realGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (c) => { window.__constraints = c; return realGum(c); };

  // A stubbed Worker: a fixed reply, and a short tone to play it with.
  const wav = (seconds) => {
    const rate = 24000, n = Math.floor(rate * seconds);
    const buf = new ArrayBuffer(44 + n * 2), view = new DataView(buf);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) view.setUint8(o + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, Math.sin(i / 18) * 20000, true);
    return buf;
  };
  const b64 = (ab) => { const u8 = new Uint8Array(ab); let t = ''; for (let i = 0; i < u8.length; i++) t += String.fromCharCode(u8[i]); return btoa(t); };
  const real = window.fetch.bind(window);
  window.__asked = [];
  window.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input.url ?? String(input);
    if (!/workers\.dev/.test(href)) return real(input, init);
    if (/\/speak$/.test(href)) {
      const chars = [...JSON.parse(init.body).text], starts = [], ends = [];
      let t = 0;
      for (const c of chars) { starts.push(t); ends.push(t + 0.012); t += 0.012; }
      return new Response(JSON.stringify({
        audio_base64: b64(wav(Math.max(0.08, t))),
        alignment: { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends },
      }), { headers: { 'content-type': 'application/json' } });
    }
    window.__asked.push(JSON.parse(init.body).messages.at(-1)?.content ?? '');
    return new Response('The kettle is in the corner by the window, behind the stool.',
      { headers: { 'content-type': 'text/plain' } });
  };
});

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.talk?.commands, null, { timeout: 180000 });
await page.evaluate(() => window.renderer.setAnimationLoop(null));

// --- 1. the stream ---
console.log('\nthe meter’s microphone:');
/* The front door is what presses the microphone — every grant the app needs
   comes out of that one tap — so pressing #mic as well would just turn it off
   again. The ears open when the greeting has finished playing. */
await page.locator('#intro button.action').click({ timeout: 8000 });
await page.waitForFunction(() => window.talk.ears.listening, null, { timeout: 40000 });
const constraints = await page.evaluate(() => window.__constraints);
console.log(`  asked for ${JSON.stringify(constraints?.audio)}`);
ok(constraints?.audio?.echoCancellation === true, 'echo cancellation is on');
ok(constraints?.audio?.autoGainControl === false, 'automatic gain is still off — it flattens the meter');
ok(constraints?.audio?.noiseSuppression === false, 'noise suppression is still off, same reason');

// --- 2. his own words, coming back ---
const greeting = await page.evaluate(() => window.talk.brain.log.at(-1)?.content ?? '');
console.log(`\nhe opened with: "${greeting}"`);

/** Feed the page a transcript and say whether it reached the model.
 *
 *  Waits for him to finish first. He is deafened while he talks, by design, so
 *  feeding a line into that window proves nothing about the filter — it would
 *  come back "ignored" whatever it said. */
const hears = async (text) => {
  await page.waitForFunction(
    () => !window.talk.brain.busy && !window.talk.voice.speaking && !window.talk.ears.muted,
    null, { timeout: 30000 },
  );
  /* And the echo tail on top. listen.ts deafens him for a beat AFTER the last
     sample, for the room's reverb coming back, so a line fed into that window
     is dropped by design and would prove nothing about the filter. */
  await page.waitForTimeout(1400);
  return page.evaluate(async (t) => {
    const before = window.__asked.length;
    window.__heard(t);
    // Longer than listen.ts's gap, which is what decides a sentence has ended.
    await new Promise((r) => setTimeout(r, 1100));
    return window.__asked.length > before;
  }, text);
};

/* Recognition does not give back the text that was spoken. It drops words,
   splits contractions, mangles names and runs sentences together — so these are
   what his own greeting plausibly comes back AS, not what it was. */
const garble = (text) => {
  // Straight apostrophes, because that is what recognition returns whatever the
  // script was typed with — which is itself a thing the filter has to survive.
  const w = text.toLowerCase().replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
  /* Only worth doing to a sentence long enough to have words to spare. Below
     that there is genuinely not enough left to tell an echo from somebody
     saying two words, and the filter is right to let it through. */
  return (w.length >= 6 ? w.filter((_, i) => i % 4 !== 3) : w).join(' ');
};

console.log('\nfed back to him:');
for (const [what, text, wanted] of [
  ['his greeting, verbatim', greeting, false],
  ['his greeting, as recognition would mangle it', garble(greeting), false],
  ['something he never said', 'what is the wifi password in here', true],
]) {
  if (!text.trim()) continue;
  const got = await hears(text);
  ok(got === wanted, `${what} → ${got ? 'answered' : 'ignored'} (wanted ${wanted ? 'answered' : 'ignored'})`);
}

// --- 3. a real reply, and the words it shares with his ---
console.log('\nafter a real answer:');
await page.evaluate(() => window.talk.say('where is the kettle'));
await page.waitForFunction(() => !window.talk.brain.busy && !window.talk.voice.speaking, null, { timeout: 30000 });
await page.waitForTimeout(400);
const reply = await page.evaluate(() => window.talk.brain.log.at(-1)?.content ?? '');
console.log(`  he said: "${reply}"`);

for (const [what, text, wanted] of [
  ['his own reply, straight back', reply, false],
  ['his own reply, mangled', garble(reply), false],
  /* THE ONES THAT MUST STILL GET THROUGH. Every false positive here is a
     conversation silently thrown away, which is a worse bug than the one this
     is fixing — so agreeing with him, quoting a few of his words back, and
     asking about the thing he just mentioned all have to survive. */
  ['agreeing with him', 'oh right, by the window', true],
  ['asking about what he said', 'which stool do you mean', true],
  ['quoting him back on purpose', 'you said the kettle is by the window did you', true],
  ['a short answer', 'no it is not', true],
]) {
  const got = await hears(text);
  ok(got === wanted, `${what} → ${got ? 'answered' : 'ignored'} (wanted ${wanted ? 'answered' : 'ignored'})`);
}

// --- 4. and it does not last for ever ---
console.log('\nand a while later:');
await page.waitForFunction(
  () => !window.talk.brain.busy && !window.talk.voice.speaking && !window.talk.ears.muted,
  null, { timeout: 30000 },
);
await page.waitForTimeout(1400);
const stale = await page.evaluate(async (t) => {
  // Everything he has said is put far enough in the past to have expired.
  const before = window.__asked.length;
  const realNow = performance.now.bind(performance);
  const skew = 20000;
  performance.now = () => realNow() + skew;
  window.__heard(t);
  await new Promise((r) => setTimeout(r, 1100));
  performance.now = realNow;
  return window.__asked.length > before;
}, reply);
ok(stale, 'twenty seconds on, the same words are somebody actually saying them');

await browser.close();
console.log(bad ? `\n${bad} problem(s)` : '\nall good');
process.exitCode = bad ? 1 : 0;
