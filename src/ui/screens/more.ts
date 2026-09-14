// The drawer everything else goes in.
import { el, icon, button } from '../dom';
import type { UiContext } from '../context';
import type { Screen } from '../shell';

/** A row that does something, with the state of the thing on the right. */
const row = (name: string, note: string, right: string | null, onTap: () => void) =>
  button('card', onTap,
    el('div.grow', {}, el('div.name', {}, name), el('div.note', {}, note)),
    right ? el('div.note', {}, right) : icon('next', 18)!);

export const more = (ctx: UiContext): Screen => {
  const build = () => {
    const captionsOn = !document.getElementById('say')?.classList.contains('off');
    const tuningOn = document.body.classList.contains('tuning');

    return el('div.cover', {},
      el('header', {},
        button('chip', () => ctx.shell.back(), icon('back', 20)),
        el('div.title', {}, 'More'),
        el('div.chip', { style: 'visibility:hidden' })),
      el('div.body', {},
        el('div.section', {}, 'Him'),
        row('Captions', 'Show what is being said', captionsOn ? 'On' : 'Off', () => {
          // The captions belong to the conversation, which put its own listeners
          // on these two elements — so this presses them rather than reaching
          // past it to set the state twice.
          document.getElementById(captionsOn ? 'say' : 'captions')?.click();
          ctx.shell.refresh();
        }),
        row('Forget the conversation', 'He keeps the last few turns', null, () => {
          ctx.talk.brain.forget();
          ctx.shell.toast('Forgotten');
        }),
        row('Back to his own idles', 'Drop any held pose or expression', null, () => {
          ctx.poses.release();
          ctx.alive.express('neutral', 0);
          ctx.alive.lookAt(null);
          ctx.shell.toast('Back to normal');
        }),

        el('div.section', {}, 'Saved'),
        row('Reset the outfit', 'Back to what the model ships with', null, () => {
          ctx.wardrobe.reset();
          ctx.shell.toast('Outfit reset');
        }),
        row('Clear saved poses', `${ctx.poses.saved.length} saved`, null, () => {
          for (const pose of [...ctx.poses.saved]) ctx.poses.remove(pose.id);
          ctx.shell.toast('Poses cleared');
          ctx.shell.refresh();
        }),
        row('Delete all photos', 'Cannot be undone', null, () => {
          void (async () => {
            await ctx.camera.clear();
            ctx.shell.toast('Photos deleted');
          })();
        }),

        el('div.section', {}, 'Developer'),
        row('Tuning panel', 'Lighting, framing, the lot', tuningOn ? 'On' : 'Off', () => {
          ctx.tuning();
          ctx.shell.refresh();
        }),

        el('div.section', {}, 'About'),
        el('div.empty', { style: 'text-align:left' },
          'A digital twin of Colin, standing in a kitchen baked in Blender. ',
          'He hears you, thinks about it, and answers in his own voice. ',
          el('br'), el('br'),
          `${ctx.colin.clips.length} clips · ${ctx.face.names.length} face shapes · `,
          `${ctx.wardrobe.items.length} wearables`)));
  };

  return { id: 'more', tabs: false, cover: build };
};
