// Does he actually feel anything, and does it show on his face?
//
// Four things, and the third is the one that makes this worth having:
//
//   1. A remark moves him a little; four of the same move him a lot. The whole
//      point of a number with inertia over a label is that it ACCUMULATES.
//   2. It wears off. A mood that never decays is a personality change.
//   3. The face is different at each corner of the plane — measured on the real
//      morph targets, not asserted from the table. Sad and cross are both
//      unhappy, and if they come out as the same face there is no reason for
//      two axes to exist.
//   4. Something said can set him off doing something nobody asked for, and
//      then leave him alone for a while.
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/mood-check.mjs http://127.0.0.1:4173/
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

/* A stubbed Worker, so an exchange can actually finish. The last section needs
   a real turn end to end — it is the moment the voice stops that lets an
   unprompted move off the leash — and a short reply keeps twelve of them inside
   the gap being measured. */
await page.addInitScript(() => {
  const REPLY = 'Right.';
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
  window.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input.url ?? String(input);
    if (!/workers\.dev/.test(href)) return real(input, init);
    if (/\/speak$/.test(href)) {
      const chars = [...JSON.parse(init.body).text], starts = [], ends = [];
      let t = 0;
      for (const c of chars) { const d = 0.03; starts.push(t); ends.push(t + d); t += d; }
      return new Response(JSON.stringify({
        audio_base64: b64(wav(Math.max(0.1, t))),
        alignment: { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends },
      }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response(REPLY, { headers: { 'content-type': 'text/plain' } });
  };
});

let bad = 0;
const fail = (why) => { console.log('  FAIL:', why); bad++; };
const ok = (yes, what) => { if (yes) console.log(`  ok   ${what}`); else fail(what); };
page.on('pageerror', (e) => { console.log('  PAGE ERROR:', e.message); bad++; });

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.poses && window.talk?.commands, null, { timeout: 180000 });
await page.evaluate(() => window.renderer.setAnimationLoop(null));

// --- 1. it adds up ---
console.log('\nbeing rude to him, four times:');
const pile = await page.evaluate(() => {
  window.feelings.set({ valence: 0, energy: 0, topic: null });
  const out = [];
  for (let i = 0; i < 4; i++) {
    window.feelings.react('you are being a complete idiot', '');
    out.push({ v: +window.feelings.valence.toFixed(3), e: +window.feelings.energy.toFixed(3), label: window.feelings.label });
  }
  return out;
});
for (const s of pile) console.log(`  mood ${s.v}  energy ${s.e}  → ${s.label}`);
ok(pile[0].v < -0.2 && pile[0].v > -0.6, 'one remark is a lean, not a lurch');
ok(pile[3].v < pile[1].v && pile[1].v < pile[0].v, 'each one lands on top of the last');
ok(pile[3].label === 'guarded', 'four of them and he is guarded');

console.log('\nand then being nice:');
const turned = await page.evaluate(() => {
  const out = [];
  for (let i = 0; i < 4; i++) {
    window.feelings.react('sorry, that was unfair. you are brilliant and very funny', '');
    out.push({ v: +window.feelings.valence.toFixed(3), label: window.feelings.label });
  }
  return out;
});
for (const s of turned) console.log(`  mood ${s.v}  → ${s.label}`);
ok(turned.at(-1).v > pile.at(-1).v, 'an apology moves him back');

// --- 2. it wears off ---
console.log('\nleaving him alone:');
const decay = await page.evaluate(() => {
  window.feelings.set({ valence: -0.9, energy: 0.8, topic: null });
  const out = [{ t: 0, v: -0.9, e: 0.8 }];
  // Stepped rather than waited: two minutes of real time to watch a half-life
  // is two minutes nobody has.
  for (const step of [30, 30, 60, 120]) {
    window.feelings.update(step);
    out.push({ t: out.at(-1).t + step, v: +window.feelings.valence.toFixed(3), e: +window.feelings.energy.toFixed(3) });
  }
  return out;
});
for (const s of decay) console.log(`  after ${String(s.t).padStart(3)}s  mood ${s.v}  energy ${s.e}`);
ok(Math.abs(decay[1].v) < 0.9 && Math.abs(decay[1].v) > 0.5, 'half a minute barely touches the mood');
ok(Math.abs(decay.at(-1).v) < 0.25, 'four minutes and he is nearly level');
ok(Math.abs(decay[2].e) < Math.abs(decay[2].v), 'energy settles faster than mood does');

// --- 3. the face, measured ---
console.log('\nthe face at each corner:');
const faces = await page.evaluate(async () => {
  const head = window.face.meshes.find((m) => 'Colin_Head_MIX' in m.morphTargetDictionary);
  const dict = head.morphTargetDictionary;
  const read = () => Object.fromEntries(Object.entries(dict)
    .map(([n, i]) => [n.replace(/_MIX$/, ''), +head.morphTargetInfluences[i].toFixed(3)])
    .filter(([n, v]) => v > 0.02 && n !== 'Colin_Head'));
  const settle = (v, e) => {
    window.alive.setFeeling(v, e);
    // Straight to it: the face eases over the best part of a second and the
    // render loop is off, so the easing is stepped by hand.
    for (let i = 0; i < 200; i++) {
      window.face.beginFrame();
      window.alive.update(0.05, window.face);
      window.face.commit();
    }
    return read();
  };
  return {
    happy: settle(0.9, 0.6),
    sad: settle(-0.9, -0.6),
    cross: settle(-0.9, 0.6),
    level: settle(0, 0),
  };
});
for (const [name, shapes] of Object.entries(faces)) {
  const top = Object.entries(shapes).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`  ${name.padEnd(6)} ${top.map(([n, v]) => `${n} ${v}`).join(', ') || '(nothing)'}`);
}
ok((faces.happy.Mouth_Smile_L ?? 0) > 0.35, 'happy is a smile');
ok((faces.sad.Mouth_Frown_L ?? 0) > 0.25 && (faces.sad.Brow_Raise_Inner_L ?? 0) > 0.3, 'sad is a frown and lifted inner brows');
ok((faces.cross.Brow_Drop_L ?? 0) > 0.35 && !(faces.cross.Mouth_Smile_L > 0.05), 'cross is the brows down, and no smile');
/* The brows point OPPOSITE WAYS in the two, which is the actual difference and
   the reason there are two axes rather than one slider. An absolute threshold
   would not do here: the corners blend, so at mood −0.9 / energy −0.6 some of
   the cross face is legitimately mixed into the sad one. */
const sadBrow = (faces.sad.Brow_Raise_Inner_L ?? 0) - (faces.sad.Brow_Drop_L ?? 0);
const crossBrow = (faces.cross.Brow_Drop_L ?? 0) - (faces.cross.Brow_Raise_Inner_L ?? 0);
ok(sadBrow > 0.3 && crossBrow > 0.3,
  `sad and cross are not the same face (brows ${sadBrow > 0 ? 'up' : 'down'} ${sadBrow.toFixed(2)} vs down ${crossBrow.toFixed(2)})`);
ok(Object.keys(faces.level).length <= 3, 'level is a face doing almost nothing');

// --- 4. unprompted ---
console.log('\nthings that might set him off:');
const spontaneous = await page.evaluate(() => {
  const tries = (heard) => {
    let hits = 0;
    for (let i = 0; i < 200; i++) if (window.talk.commands.suggest(heard, '')) hits++;
    return hits / 200;
  };
  return {
    song: tries('I heard the best song on the radio this morning'),
    gym: tries('I went to the gym before work'),
    bye: tries('right, I should go. see you later'),
    // Nothing in it. A reaction that fires on ordinary conversation is a man
    // who dances at the mention of weather.
    weather: tries('it looks like rain again'),
    dull: tries('what is the capital of France'),
  };
});
for (const [k, v] of Object.entries(spontaneous)) console.log(`  ${k.padEnd(8)} ${Math.round(v * 100)}% of the time`);
ok(spontaneous.song > 0.25 && spontaneous.song < 0.8, 'a song sets him off sometimes, not always');
ok(spontaneous.gym > 0.15, 'so does the gym');
ok(spontaneous.weather === 0 && spontaneous.dull === 0, 'ordinary conversation does not');

console.log('\ntwelve songs in a row, with the Worker stubbed:');
const paced = await page.evaluate(async () => {
  window.stage.go('kitchen', true);
  await new Promise((r) => setTimeout(r, 200));
  window.poses.release();
  window.feelings.set({ valence: 0, energy: 0, topic: null });
  await window.talk.voice.arm();

  const fired = [];
  const before = console.log;
  console.log = (...a) => { const m = /^unprompted — (\w+)/.exec(String(a[0])); if (m) fired.push(m[1]); before(...a); };
  const idle = async () => {
    for (let i = 0; i < 400; i++) {
      await new Promise((r) => setTimeout(r, 25));
      if (!window.talk.brain.busy && !window.talk.voice.speaking) return;
    }
  };
  for (let i = 0; i < 12; i++) {
    window.talk.say('put on a song, I love that track');
    await idle();
    // A moment for the voice to finish handing back, which is when a held idea
    // is let off the leash.
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log = before;
  return { fired, mood: +window.feelings.valence.toFixed(2), energy: +window.feelings.energy.toFixed(2), dancing: window.poses.clip };
});
console.log(`  fired: ${paced.fired.join(', ') || '(none)'} · mood ${paced.mood} energy ${paced.energy} · now ${paced.dancing ?? 'standing'}`);
ok(paced.fired.length === 1, 'exactly one unprompted move in twelve turns (a 38s gap between them)');
ok(paced.dancing !== null, 'and he is still doing it');
ok(paced.mood > 0.1, 'twelve people saying they love a track also cheered him up');

await browser.close();
console.log(bad ? `\n${bad} problem(s)` : '\nall good');
process.exitCode = bad ? 1 : 0;
