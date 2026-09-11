// Exercises the whole talking pipeline against a stubbed Worker, in headless
// Chromium. Nothing here needs the network, a microphone, or a key: the brain
// and the voice are both intercepted, so what is actually under test is the part
// that is ours — the chat body, the streamed reply, the audio scheduling, the
// character timings, and whether the mouth on the real head moves.
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/talk-check.mjs http://127.0.0.1:4173/
//
// Playwright is not a project dependency: npm i -D playwright first. The browser
// is already on the box in the remote sessions (/opt/pw-browsers), which is what
// CHROME points at.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
// Playwright's own download, unless a prebuilt one is on the box.
const CHROME = process.env.CHROME_PATH
  || (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
      ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio',
         '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('console', (m) => console.log('  page:', m.text().slice(0, 200)));
page.on('pageerror', (e) => console.log('  PAGE ERROR:', e.message));

// Stub the Worker: a streamed reply, and a loud tone with a plausible alignment.
await page.addInitScript(() => {
  const REPLY = 'Hello. I am standing right here in the kitchen.';
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
  const b64 = (ab) => {
    const u8 = new Uint8Array(ab); let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  };
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input.url ?? String(input);
    if (!/workers\.dev/.test(href)) return real(input, init);
    if (/\/speak$/.test(href)) {
      const text = JSON.parse(init.body).text;
      const chars = [...text], starts = [], ends = [];
      let t = 0;
      for (const c of chars) { const d = c === ' ' ? 0.05 : 0.055; starts.push(t); ends.push(t + d); t += d; }
      window.__spoke = (window.__spoke || []).concat(text);
      return new Response(JSON.stringify({
        audio_base64: b64(wav(t)),
        alignment: { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends },
      }), { headers: { 'content-type': 'application/json' } });
    }
    window.__asked = JSON.parse(init.body);
    return new Response(new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        c.enqueue(enc.encode(REPLY.slice(0, 20)));
        setTimeout(() => { c.enqueue(enc.encode(REPLY.slice(20))); c.close(); }, 60);
      },
    }), { headers: { 'content-type': 'text/plain' } });
  };
});

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.talk && window.head, null, { timeout: 180000 });
console.log('app up');

const rigInfo = await page.evaluate(() => ({ rig: window.talk.face.rig, jaw: window.talk.face.jawShape,
                                             morphs: Object.keys(window.head.morphs).length }));
console.log('face driver:', rigInfo);

// Software WebGL renders one frame every couple of seconds and blocks the main
// thread doing it, which starves the sampler below and proves nothing about the
// mouth. The room is already up; stop drawing it.
await page.evaluate(() => window.renderer.setAnimationLoop(null));
// Talking has to survive a browser that never gave us a gesture: arm by hand.
await page.evaluate(() => window.talk.voice.arm());
await page.evaluate(() => window.talk.say('hello, where are you standing?'));

// The render loop is a slide show under swiftshader, so step the mouth by hand
// and sample what it does. Real time still passes, which is what the timeline
// and the analyser are both keyed to.
const trace = await page.evaluate(async () => {
  const out = [];
  const t0 = performance.now();
  for (let i = 0; i < 420; i++) {
    await new Promise((r) => setTimeout(r, 20));
    window.talk.update(0.02);
    const inf = window.head.meshes[0].morphTargetInfluences;
    let max = 0, which = -1;
    for (let k = 0; k < inf.length; k++) if (Math.abs(inf[k]) > max) { max = Math.abs(inf[k]); which = k; }
    out.push({ ms: Math.round(performance.now() - t0), speaking: window.talk.voice.speaking,
               shape: window.talk.voice.shape(), max: +max.toFixed(3), which });
  }
  return out;
});
const names = await page.evaluate(() => {
  const d = window.head.meshes[0].morphTargetDictionary;
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [v, k]));
});

const spoke = await page.evaluate(() => window.__spoke || []);
const asked = await page.evaluate(() => window.__asked);
console.log('asked with:', JSON.stringify(asked).slice(0, 300));
console.log('sent to the voice:', spoke);

const shapes = [...new Set(trace.filter((t) => t.speaking).map((t) => t.shape))];
const moved = trace.filter((t) => t.max > 0.05);
console.log('shapes seen while speaking:', shapes.join(' '));
console.log('frames with the mouth open:', moved.length, 'of', trace.length);
console.log('largest influence:', Math.max(...trace.map((t) => t.max)).toFixed(3));
console.log('shapes driven:', [...new Set(moved.map((t) => names[t.which]))].join(' '));
console.log('speaking window:', trace.findIndex((t) => t.speaking), '->', trace.map((t) => t.speaking).lastIndexOf(true));
const tail = trace.slice(-30);
console.log('settled at the end:', tail.every((t) => !t.speaking), 'last max', tail[tail.length - 1].max);
const changes = trace.filter((t, i) => i && t.shape !== trace[i - 1].shape).length;
console.log('shape changes:', changes, 'over', Math.round((trace.at(-1).ms) / 1000) + 's');
console.log('released the face:', await page.evaluate(() => {
  const inf = window.head.meshes[0].morphTargetInfluences;
  const before = Array.from(inf);
  window.head.setMorph('V_Open', 0.7);
  window.talk.update(0.016); window.talk.update(0.016);
  const i = window.head.morphs.V_Open;
  return { held: inf[i], wasRest: Math.max(...before.map(Math.abs)).toFixed(3) };
}));
console.log(trace.filter((_, i) => i % 12 === 0).map((t) => `${t.ms}:${t.shape}${t.max > 0.05 ? '*' : ''}`).join(' '));

await browser.close();
