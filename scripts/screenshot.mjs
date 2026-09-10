// Headless screenshot of the running app — for checking the render without a
// browser in front of you (remote sessions, CI, before/after tuning passes).
//
//   npm run build && npx vite preview --port 4173
//   node scripts/screenshot.mjs http://127.0.0.1:4173/ shot.png 1500x1000
//
// Playwright is not a project dependency; install it only if you want this:
//   npm i -D playwright && npx playwright install chromium
// Set CHROME_PATH to use a Chromium you already have.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. Run:\n  npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const out = process.argv[3] ?? 'shot.png';
const [width, height] = (process.argv[4] ?? '1500x1000').split('x').map(Number);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  // Software WebGL, so this works on machines with no GPU.
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width, height } });
page.on('console', (m) => console.log(`[${m.type()}]`, m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('response', (r) => r.status() >= 400 && console.log('[http]', r.status(), r.url()));

await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
try {
  await page.waitForSelector('body.ready', { timeout: 180_000 });
} catch {
  console.error('Scene never became ready. Overlay says:', await page.textContent('#loading').catch(() => '(gone)'));
}
await page.waitForTimeout(4000);   // let PMREM and the first frames settle
await page.screenshot({ path: out });
console.log('wrote', out);
await browser.close();
