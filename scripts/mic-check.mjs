// The microphone path: press the button, and check that he greets first, that
// the recogniser is started exactly once, and that the greeting is never the
// same line twice running.
//
// The start count is the point. iOS plays a system tone on every
// `SpeechRecognition.start()` and a page cannot suppress it, so the only lever
// is how rarely the recogniser is switched on. One press, one start, however
// many exchanges follow.
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/mic-check.mjs http://127.0.0.1:4173/
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", isMobile: true, hasTouch: true });
page.on('pageerror', (e) => console.log('  PAGE ERROR:', e.message));
page.on('console', (m) => console.log('  page:', m.text().slice(0, 160)));

await page.addInitScript(() => {
  // A recogniser that does nothing but count how often it is switched on —
  // which on iOS is exactly how often the system tone plays.
  window.__starts = 0;
  class FakeSR {
    start() { window.__starts++; this.onstart?.(); }
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
  }
  // Chromium defines the unprefixed name too, and listen.ts prefers it.
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;

  const wav = (seconds) => {
    const rate = 24000, n = Math.floor(rate * seconds);
    const buf = new ArrayBuffer(44 + n * 2), view = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, Math.sin(i / 18) * 26000, true);
    return buf;
  };
  const b64 = (ab) => { const u8 = new Uint8Array(ab); let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input.url ?? String(input);
    if (!/workers\.dev/.test(href)) return real(input, init);
    if (/\/speak$/.test(href)) {
      const text = JSON.parse(init.body).text;
      const chars = [...text], starts = [], ends = [];
      let t = 0;
      /* Long enough that the shortest greeting in the set still outlasts the
         check below. At 0.03 s a character, "Yeah? What." is a third of a
         second of audio — it finishes, hands the microphone over, and the
         "starts so far" reading catches the recogniser already running. The
         shortest line is eleven characters, so this is about a second. */
      for (const c of chars) { const d = 0.09; starts.push(t); ends.push(t + d); t += d; }
      // What was spoken, and whether the mic was already open when it was.
      window.__spoke = (window.__spoke || []).concat({ text, earsOpen: window.talk?.ears?.listening ?? null });
      return new Response(JSON.stringify({ audio_base64: b64(wav(t)),
        alignment: { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends } }),
        { headers: { 'content-type': 'application/json' } });
    }
    return new Response('ok', { headers: { 'content-type': 'text/plain' } });
  };
});

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.talk && window.face, null, { timeout: 180000 });
await page.evaluate(() => window.renderer.setAnimationLoop(null));
await page.evaluate(() => window.talk.voice.arm());

const mic = await page.$('#mic');
console.log('mic enabled:', await mic.isEnabled(), '| label:', (await mic.textContent()));

/* The front door is what presses it now. The intro covers the screen until it
   is answered, which is the whole point of it — every grant the app needs comes
   out of that one tap — so the first press is made there rather than reaching
   past it to the button underneath. */
await page.locator('#intro button.action').click();
await page.waitForTimeout(150);
await page.waitForFunction(() => (window.__spoke || []).length > 0, null, { timeout: 10000 });
const atGreeting = await page.evaluate(() => ({
  spoke: window.__spoke[0], starts: window.__starts, earsOpen: window.talk.ears.listening,
  caption: document.getElementById('say').textContent,
}));
console.log('greeting:', JSON.stringify(atGreeting.spoke.text));
console.log('mic open while greeting:', atGreeting.spoke.earsOpen, '(want false)');
console.log('recogniser starts so far:', atGreeting.starts, '(want 0)');

// Let the greeting finish; the mic should come up exactly once.
await page.waitForFunction(() => window.talk.ears.listening, null, { timeout: 15000 });
const after = await page.evaluate(() => ({ starts: window.__starts, label: document.getElementById('mic').textContent }));
console.log('after the greeting: starts', after.starts, '(want 1) | label', JSON.stringify(after.label));

// A reply, mid-conversation: mute/unmute must not restart the recogniser.
await page.evaluate(() => window.talk.say('is this thing on?'));
await page.waitForFunction(() => (window.__spoke || []).length > 1, null, { timeout: 15000 });
await page.waitForFunction(() => !window.talk.voice.speaking, null, { timeout: 20000 });
await page.waitForTimeout(600);
console.log('after a reply: starts', await page.evaluate(() => window.__starts), '(want still 1)');

// Sixteen lines, and a fresh one every press: tap the button off and on and
// make sure the greeting is never the one just heard.
let last = await page.evaluate(() => window.__spoke[0].text);
for (let i = 0; i < 6; i++) {
  await page.click('#mic');                       // off
  await page.click('#mic');                       // on again
  await page.waitForFunction((n) => (window.__spoke || []).length > n,
    await page.evaluate(() => window.__spoke.length - 1), { timeout: 10000 });
  const line = await page.evaluate(() => window.__spoke.at(-1).text);
  if (line === last) { console.log('REPEATED:', JSON.stringify(line)); process.exitCode = 1; }
  last = line;
  await page.evaluate(() => window.talk.voice.stop());
}
console.log('six more presses, no line twice running');

await browser.close();
