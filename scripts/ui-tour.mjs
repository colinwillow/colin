// A walk through every screen, at phone size, one PNG each.
//
// This is the only way to look at the interface from a remote session, and it
// doubles as the check that none of the screens throws on the way in or out —
// a page error anywhere in the tour fails it.
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/ui-tour.mjs http://127.0.0.1:4173/ .tour
//
// Playwright is not a project dependency: npm i -D playwright first.
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const out = process.argv[3] || '.tour';
const CHROME = process.env.CHROME_PATH
  || (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);

mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    // A microphone that is always there and always making a noise, so the meter
    // can be photographed reading real audio rather than its fallback.
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  permissions: ['microphone'],
});

const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('  PAGE ERROR:', e.message); });
page.on('console', (m) => {
  const text = m.text();
  if (m.type() === 'error') { errors.push(text); console.log('  console error:', text.slice(0, 200)); }
  else if (/ready|quality|face —|visemes —/.test(text)) console.log('  ', text.slice(0, 160));
});

await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
await page.waitForSelector('body.ready', { timeout: 240_000 });
// Software WebGL draws a frame every second or so; give the first ones room.
await page.waitForTimeout(6000);

/** Tap something by its visible text, or by selector if it starts with a dot. */
const tap = async (what) => {
  const target = what.startsWith('#') || what.startsWith('.')
    ? page.locator(what).first()
    : page.locator(`#ui button:has-text("${what}")`).first();
  await target.click({ timeout: 8000 });
  await page.waitForTimeout(2600);
};

const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('  wrote', `${out}/${name}.png`);
};

const steps = [
  // The front door, and then him with nothing on top of him.
  ['intro', async () => {}],
  ['stage', async () => tap('Say hello')],
  ['stage-captions', async () => { await tap('#captions'); await page.waitForTimeout(700); }],
  ['home', async () => tap('#tabs .chip')],
  ['outfits', async () => tap('Outfits')],
  ['poses', async () => { await tap('.chip'); await tap('Poses'); }],
  ['poses-dancing', async () => tap('Dancing')],
  ['poses-held', async () => { await tap('Wiggle feet'); await tap('Hold'); }],
  ['readings', async () => { await tap('.chip'); await tap('Readings'); }],
  ['mood', async () => { await tap('.chip'); await tap('Mood'); }],
  ['emotes', async () => { await tap('.chip'); await tap('Emotes'); }],
  ['look', async () => { await tap('.chip'); await tap('Look'); }],
  ['look-surface', async () => tap('Surface')],
  ['rooms', async () => { await tap('.chip'); await tap('Rooms'); }],
  // The white room is the default now, so the interesting move is the other way.
  ['rooms-white', async () => tap('Studio')],
  ['rooms-kitchen', async () => tap('Kitchen')],
  ['rooms-slate', async () => tap('Slate')],
  ['rooms-paper', async () => tap('Paper')],
  ['camera', async () => tap('#ui #head button:last-of-type')],
  ['camera-portrait', async () => tap('Portrait')],
  ['gallery', async () => { await tap('#shutter'); await tap('.last'); }],
  // Out of the gallery, out of the camera, and only then is the tab bar back.
  ['more', async () => { await tap('.chip'); await tap('.chip'); await tap('More'); }],
  ['toon-on', async () => tap('Toon shading')],
  /* The comparison the whole experiment is for. Routed through the shell rather
     than by tapping, because by this point the back trail is four screens deep
     and which chip goes where stops being the thing under test. */
  ['toon-studio', async () => {
    await page.evaluate(() => { window.stage.go('white'); window.ui.go('rooms'); });
    await page.waitForTimeout(3000);
  }],
  ['toon-portrait', async () => {
    await page.evaluate(() => window.ui.go('emotes'));
    await page.waitForTimeout(3000);
  }],
  ['plain-studio', async () => {
    await page.evaluate(() => { window.toon.config.amount = 0; window.toon.apply(); window.ui.go('rooms'); });
    await page.waitForTimeout(3000);
  }],
];

for (const [name, run] of steps) {
  try {
    await run();
    await shot(name);
  } catch (err) {
    console.log(`  FAILED at ${name}: ${err.message.split('\n')[0]}`);
    await shot(`${name}-failed`);
    errors.push(`${name}: ${err.message.split('\n')[0]}`);
  }
}

await browser.close();
if (errors.length) {
  console.log(`\n${errors.length} problem(s):`);
  for (const e of errors) console.log(' -', e);
  process.exitCode = 1;
} else {
  console.log('\nno errors on any screen');
}
