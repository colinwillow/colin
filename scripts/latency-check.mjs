// Does he start talking before the reply has finished being written?
//
// The thing being measured is the pause you actually feel, and it used to be
// three waits end to end: the model thinking, the model finishing, and the voice
// rendering. This stubs a Worker that takes a deliberate second to write its
// second sentence, and checks that the first one was sent to be spoken long
// before the stream closed.
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/latency-check.mjs http://127.0.0.1:4173/
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const CHROME = process.env.CHROME_PATH
  || (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => console.log('  PAGE ERROR:', e.message));
page.on('console', (m) => { if (/^turn —/.test(m.text())) console.log(' ', m.text()); });

await page.addInitScript(() => {
  /* Two sentences, a second apart. The first is long enough to be worth sending
     on its own; if nothing is spoken until the stream closes, the first /speak
     lands after the 1000 ms mark rather than before it. */
  const ONE = 'Right, I have been standing here for a while thinking about that.';
  const TWO = ' It is not a short answer and you are going to have to sit through it.';
  const WRITE_DELAY = 1000;

  const wav = (seconds) => {
    const rate = 24000, n = Math.floor(rate * seconds);
    const buf = new ArrayBuffer(44 + n * 2), view = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, Math.sin(i / 18) * 20000, true);
    return buf;
  };
  const b64 = (ab) => { const u8 = new Uint8Array(ab); let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };

  window.__marks = [];
  const mark = (what) => window.__marks.push({ what, at: performance.now() - (window.__t0 ?? 0) });

  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input.url ?? String(input);
    if (!/workers\.dev/.test(href)) return real(input, init);
    if (/\/speak$/.test(href)) {
      const text = JSON.parse(init.body).text;
      mark(`speak: ${text.slice(0, 28)}…`);
      const chars = [...text], starts = [], ends = [];
      let t = 0;
      for (const _ of chars) { starts.push(t); ends.push(t + 0.04); t += 0.04; }
      return new Response(JSON.stringify({ audio_base64: b64(wav(t)),
        alignment: { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends } }),
        { headers: { 'content-type': 'application/json' } });
    }
    window.__t0 = performance.now();
    mark('asked');
    return new Response(new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        c.enqueue(enc.encode(ONE));
        mark('first sentence written');
        setTimeout(() => {
          c.enqueue(enc.encode(TWO));
          mark('reply finished');
          c.close();
        }, WRITE_DELAY);
      },
    }), { headers: { 'content-type': 'text/plain' } });
  };
});

await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
await page.waitForSelector('body.ready', { timeout: 240_000 });
await page.evaluate(() => window.renderer.setAnimationLoop(null));
await page.evaluate(() => window.talk.voice.arm());
await page.evaluate(() => window.talk.say('go on then'));
await page.waitForTimeout(4000);

const marks = await page.evaluate(() => window.__marks);
for (const m of marks) console.log(`  ${String(Math.round(m.at)).padStart(5)}ms  ${m.what}`);

const firstSpeak = marks.find((m) => m.what.startsWith('speak:'));
const finished = marks.find((m) => m.what === 'reply finished');
const speaks = marks.filter((m) => m.what.startsWith('speak:')).length;
console.log(`\n  pieces sent to the voice: ${speaks}`);
if (!firstSpeak || !finished) {
  console.log('  FAILED: never got both marks');
  process.exitCode = 1;
} else if (firstSpeak.at >= finished.at) {
  console.log(`  FAILED: nothing was spoken until the reply was finished (+${Math.round(firstSpeak.at - finished.at)}ms)`);
  process.exitCode = 1;
} else {
  console.log(`  first sentence went to the voice ${Math.round(finished.at - firstSpeak.at)}ms `
    + 'before the reply finished being written');
}
await browser.close();
