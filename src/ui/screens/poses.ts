// Poses, which are not assets.
//
// A pose is a frame of a clip: pick an animation, stop its clock, and what is
// left standing there is a pose you can keep. `Hold` is the freeze, `Save` keeps
// wherever it was frozen, and the saved ones come back as their own row.
import { el, icon, button } from '../dom';
import type { UiContext } from '../context';
import type { Screen } from '../shell';

const SAVED = 'saved';

export const poses = (ctx: UiContext): Screen => {
  const groups = ctx.poses.groups;
  let group = sessionStorage.getItem('colin.ui.poseGroup') ?? groups[0]?.id ?? SAVED;
  if (group !== SAVED && !groups.some((g) => g.id === group)) group = groups[0]?.id ?? SAVED;

  const pickGroup = (id: string) => {
    group = id;
    sessionStorage.setItem('colin.ui.poseGroup', id);
    ctx.shell.refresh();
  };

  return {
    id: 'poses',
    // Head to toe. A pose is what the whole body is doing, and half of these are
    // dances — there is nothing to see in a portrait of a moonwalk.
    shot: 'full',

    exit: () => {
      /* A held pose is a decision, so it survives leaving the screen. A clip
         left running is not — that is just the last thing that was tapped, and
         he should go back to being himself. */
      if (!ctx.poses.holding) ctx.poses.release();
    },

    head: () => el('div', { style: 'display:flex;align-items:center;gap:12px;width:100%' },
      button('chip.glass', () => ctx.shell.back(), icon('back', 20)),
      el('div.title', {}, 'Poses'),
      el('div.spring'),
      button('chip.glass', () => ctx.shell.go('camera'), icon('photos', 19))),

    tray: () => {
      const tabs = el('div.segments.glass', {},
        ...groups.map((g) => button(`${group === g.id ? 'on' : ''}`, () => pickGroup(g.id), g.name)),
        button(`${group === SAVED ? 'on' : ''}`, () => pickGroup(SAVED), 'Saved'));

      let row: HTMLElement;
      if (group === SAVED) {
        row = ctx.poses.saved.length
          ? el('div.scroll', {}, ...ctx.poses.saved.map((pose) => {
            const tile = button(`tile.glass${ctx.poses.clip === pose.clip ? '.on' : ''}`,
              () => { ctx.poses.restore(pose.id); ctx.shell.refresh(); },
              el('div.swatch', {}, icon('poses', 20)),
              el('div.label', {}, pose.name));
            tile.appendChild(button('x', () => {
              ctx.poses.remove(pose.id);
              ctx.shell.refresh();
            }, icon('close', 12)));
            return tile;
          }))
          : el('div.empty', {}, 'Nothing saved yet. Hold a pose you like, then Save it.');
      } else {
        const list = groups.find((g) => g.id === group)?.poses ?? [];
        row = el('div.scroll', {}, ...list.map((pose) =>
          button(`tile.glass${ctx.poses.clip === pose.clip ? '.on' : ''}`,
            () => { ctx.poses.play(pose.clip); ctx.shell.refresh(); },
            el('div.swatch', {}, icon(group === 'dance' ? 'dance' : 'poses', 20)),
            el('div.label', {}, pose.name))));
      }

      const holding = ctx.poses.holding;
      const running = ctx.poses.clip !== null;
      const controls = el('div.pills', {},
        button('action.quiet', () => {
          if (!running) return;
          ctx.poses.hold(!holding);
          ctx.shell.refresh();
        }, icon(holding ? 'play' : 'hold', 18), holding ? 'Play' : 'Hold'),
        button('action', () => {
          // Saving a moving clip means saving whichever frame the tap landed on,
          // so freeze first: what you keep is then what you were looking at.
          if (!running) { ctx.shell.toast('Pick a pose first'); return; }
          if (!ctx.poses.holding) ctx.poses.hold(true);
          const saved = ctx.poses.save();
          ctx.shell.toast(saved ? `Saved “${saved.name}”` : 'Could not save that');
          ctx.shell.refresh();
        }, icon('check', 18), 'Save Pose'));
      if (!running) controls.querySelectorAll('button')[0].setAttribute('disabled', '');

      return el('div', { style: 'display:grid;gap:10px;justify-items:stretch' }, tabs, row, controls);
    },
  };
};
