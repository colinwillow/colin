// The viewfinder.
//
// There is nothing to composite and nothing to hide: the picture is the canvas,
// and every control on this screen is a DOM overlay that the drawing buffer has
// never heard of. So the shot is always exactly what is behind the buttons.
//
// The mode row is the framing rather than a file format — stills are all this
// takes — so PORTRAIT really is a 72mm lens and WIDE really does back the camera
// off. Choosing one is choosing a lens, which is the only camera control here
// worth having.
import { el, icon, button } from '../dom';
import type { ShotName } from '../../shot';
import type { UiContext } from '../context';
import type { Screen } from '../shell';

const MODES: { id: ShotName; label: string }[] = [
  { id: 'wide', label: 'Wide' },
  { id: 'full', label: 'Full' },
  { id: 'half', label: 'Half' },
  { id: 'portrait', label: 'Portrait' },
];

export const camera = (ctx: UiContext): Screen => {
  let mode: ShotName = (sessionStorage.getItem('colin.ui.shot') as ShotName) || 'full';
  if (!MODES.some((m) => m.id === mode)) mode = 'full';

  const last = el('button.last', { type: 'button', 'aria-label': 'gallery' });
  last.addEventListener('click', () => ctx.shell.go('gallery'));

  const shutter = el('button#shutter', { type: 'button', 'aria-label': 'take a photo' });
  const modes = el('div.modes');

  const paintModes = () => {
    modes.textContent = '';
    for (const m of MODES) {
      modes.appendChild(button(`${mode === m.id ? 'on' : ''}`, () => {
        mode = m.id;
        sessionStorage.setItem('colin.ui.shot', m.id);
        ctx.stage.frame(m.id);
        paintModes();
      }, m.label));
    }
  };

  const showLast = async () => {
    const [newest] = await ctx.camera.list();
    if (!newest) { last.style.backgroundImage = ''; return; }
    last.style.backgroundImage = `url(${URL.createObjectURL(newest.thumb)})`;
  };

  const take = async () => {
    if (ctx.camera.pending) return;
    shutter.setAttribute('disabled', '');
    try {
      const photo = await ctx.camera.capture(ctx.stage.current.name);
      ctx.shell.flash();
      last.style.backgroundImage = `url(${URL.createObjectURL(photo.thumb)})`;
      ctx.shell.toast('Saved to the gallery');
    } catch (err) {
      ctx.shell.toast(err instanceof Error ? err.message : 'Could not take that');
    } finally {
      shutter.removeAttribute('disabled');
    }
  };
  shutter.addEventListener('click', () => { void take(); });

  return {
    id: 'camera',
    tabs: false,
    shot: mode,

    enter: () => { void showLast(); },
    exit: () => { ctx.alive.lookAt(null); },

    cover: () => {
      paintModes();
      return el('div.cover.viewfinder', {},
        el('header', {},
          button('chip', () => ctx.shell.back(), icon('close', 20)),
          el('div.spring'),
          button('chip', () => {
            // Put the turntable back where it started — easy to spin a long way
            // round and not know which way is front any more.
            ctx.shots.orbit = 0;
            ctx.shots.zoom = 1;
          }, icon('shuffle', 19))),
        el('div.spring', { style: 'flex:1' }),
        modes,
        el('div.controls', {},
          last,
          shutter,
          button('chip', () => {
            // He looks down the lens. Nobody wants a photo of someone looking
            // slightly past them.
            ctx.alive.lookAt(0, 0);
            ctx.alive.blinkNow();
            ctx.shell.toast('Eyes on the camera');
          }, icon('mood', 20))));
    },
  };
};
