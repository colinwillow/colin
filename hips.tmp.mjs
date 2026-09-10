import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(process.argv[2], { waitUntil: 'load', timeout: 240000 });
await page.waitForSelector('body.ready', { timeout: 300000 });
await page.waitForTimeout(3000);
console.log(JSON.stringify(await page.evaluate(() => {
  const T = window.THREE, c = window.colin;
  const mixer = c.mixer;
  // Which actions are actually running, and with what weight?
  const running = [];
  for (const clip of mixer._actions ?? []) {
    running.push({ clip: clip._clip.name, weight: +clip.getEffectiveWeight().toFixed(3),
                   enabled: clip.enabled, running: clip.isRunning(), time: +clip.time.toFixed(2) });
  }
  // Does the clip even carry a hips position track once three has parsed it?
  const clipObj = mixer._actions?.[0]?._clip;
  const hipsTracks = (clipObj?.tracks ?? []).filter(t => /hips/i.test(t.name)).map(t => ({
    name: t.name, values: t.values.length, times: t.times.length,
    range: t.name.endsWith('.position')
      ? +(Math.max(...[...t.values].filter((_, i) => i % 3 === 0)) - Math.min(...[...t.values].filter((_, i) => i % 3 === 0))).toFixed(4)
      : null,
  }));
  let hips = null;
  c.model.traverse(o => { if (/hips/i.test(o.name) && !hips) hips = o; });
  return {
    runningActions: running,
    hipsTracksInClip: hipsTracks,
    hipsLocalPos: hips.position.toArray().map(v => +v.toFixed(4)),
    hipsIsBone: !!hips.isBone,
    hipsParent: hips.parent?.name,
    hipsParentScale: hips.parent?.scale.toArray(),
  };
}, null), null, 1));
await browser.close();
