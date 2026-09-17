// The hub. Him in the middle, everything else arranged around him.
import { el, icon, button } from '../dom';
import type { UiContext } from '../context';
import type { Screen } from '../shell';

const HUB: { id: string; label: string; icon: string }[] = [
  { id: 'outfits', label: 'Outfits', icon: 'outfits' },
  { id: 'mood', label: 'Mood', icon: 'mood' },
  { id: 'rooms', label: 'Rooms', icon: 'rooms' },
  { id: 'poses', label: 'Poses', icon: 'poses' },
  { id: 'emotes', label: 'Emotes', icon: 'emotes' },
  { id: 'camera', label: 'Photos', icon: 'photos' },
];

/** What he is doing, in three words, under his name. */
function status(ctx: UiContext): string {
  if (ctx.talk.voice.speaking) return 'Talking';
  if (ctx.talk.brain.busy) return 'Thinking about it';
  if (ctx.talk.listening) return 'Listening';
  if (ctx.poses.clip) return ctx.poses.holding ? 'Holding a pose' : 'Doing a bit';
  return ctx.stage.current.kind === 'studio'
    ? `In the ${ctx.stage.current.name.toLowerCase()}`
    : 'In the kitchen';
}

export const home = (ctx: UiContext): Screen => {
  const sub = el('div.sub', {}, status(ctx));

  return {
    id: 'home',
    // Whatever the room he is in opens on: the kitchen hands the camera back to
    // the rig so he can walk around, a studio frames him head to toe.
    shot: ctx.stage.current.shot,

    head: () => el('div#greeting', {},
      el('div.avatar', { style: `background-image: url(${import.meta.env.BASE_URL}icons/apple-touch-icon.png)` }),
      el('div', {},
        el('div.title', {}, 'Colin'),
        sub),
      el('div.spring'),
      button('chip.glass', () => ctx.shell.go('more'), icon('gear', 19)),
      /* Out of the app and back to him. The hub is a place you visited, not
         where the app lives, and there has to be a door marked so. */
      button('chip.glass', () => ctx.shell.go('stage'), icon('close', 19))),

    body: () => {
      // Three down each side, so he is never behind a button.
      const column = (items: typeof HUB) => el('div#hub', {}, ...items.map((item) =>
        button('glass', () => ctx.shell.go(item.id), icon(item.icon, 21), el('span', {}, item.label))));
      return [column(HUB.slice(0, 3)), column(HUB.slice(3))];
    },

    update: () => {
      const now = status(ctx);
      if (sub.textContent !== now) sub.textContent = now;
    },
  };
};
