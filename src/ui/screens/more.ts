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
        el('div.section', {}, 'Look'),
        row('His look', 'Brightness, roughness, emission, saturation', null,
          () => ctx.shell.go('look')),
        /* One switch on an experiment with ten numbers behind it. The numbers
           are in the tuning panel; this is the only one worth having a button
           for, because the question it answers is "which of the two do I
           prefer" and that is asked by looking, not by tuning. */
        row('Toon shading', 'Flat bands, a rim light and an ink line',
          ctx.toon.config.amount > 0 ? 'On' : 'Off', () => {
            ctx.toon.config.amount = ctx.toon.config.amount > 0 ? 0 : 1;
            ctx.toon.apply();
            ctx.shell.toast(ctx.toon.config.amount > 0 ? 'Drawn' : 'Rendered');
            ctx.shell.refresh();
          }),

        el('div.section', {}, 'Him'),
        row('Captions', 'Show what is being said', captionsOn ? 'On' : 'Off', () => {
          // The captions belong to the conversation, which put its own listeners
          // on these two elements — so this presses them rather than reaching
          // past it to set the state twice.
          document.getElementById(captionsOn ? 'say' : 'captions')?.click();
          ctx.shell.refresh();
        }),
        row('Your microphone', ctx.talk.heard.on
          ? 'The meter is reading your actual voice'
          : ctx.talk.heard.refused
            ? 'Refused — the meter is guessing from the words instead'
            : 'Opens when you first say hello',
        ctx.talk.heard.on ? 'On' : 'Off', () => {
          ctx.shell.toast(ctx.talk.heard.on
            ? 'Already listening to the room'
            : 'Press talk and allow the microphone');
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
          `${ctx.wardrobe.items.length} wearables`,
          el('br'), el('br'),
          el('span', { style: 'font-size:12px;opacity:.7' },
            Object.entries(ctx.capabilities).map(([k, v]) => `${k} ${v}`).join(' · ')))));
  };

  return { id: 'more', chrome: 'none', cover: build };
};
