// Two screens that are easy to confuse and are not the same thing.
//
//   Mood   — what he is like right now. It picks which idle he falls into and
//            what his face sits at, and it stays until something changes it.
//   Emotes — one thing, once. A wave, a raised brow, a blink.
//
// Both are trays rather than full screens, because the whole point of pressing
// "amused" is watching his face do it.
import { el, icon, button } from '../dom';
import type { Mood } from '../../mood';
import { EXPRESSION_FOR } from '../../mood';
import type { ExpressionName } from '../../face';
import type { UiContext } from '../context';
import type { Screen } from '../shell';

const MOODS: { id: Mood; name: string; note: string }[] = [
  { id: 'neutral', name: 'Chill', note: 'Nothing in particular' },
  { id: 'happy', name: 'Happy', note: 'Pleased with himself' },
  { id: 'curious', name: 'Curious', note: 'Wants to know' },
  { id: 'guarded', name: 'Guarded', note: 'Not having it' },
  { id: 'sad', name: 'Sad', note: 'Bit of a day' },
  { id: 'hungry', name: 'Hungry', note: 'Thinking about the fridge' },
];

export const mood = (ctx: UiContext): Screen => ({
  id: 'mood',
  // Chest up: a mood is mostly a face, and his idle carries the rest.
  shot: 'half',

  head: () => el('div', { style: 'display:flex;align-items:center;gap:12px;width:100%' },
    button('chip.glass', () => ctx.shell.back(), icon('back', 20)),
    el('div.title', {}, 'Mood'),
    el('div.spring')),

  tray: () => el('div.scroll', {}, ...MOODS.map((m) =>
    button(`tile.glass${ctx.wander.moodIdle === m.id ? '.on' : ''}`, () => {
      /* A mood and a held pose are both answers to "what is he doing", so one
         has to give: picking a mood hands him back to his own idles. */
      ctx.poses.release();
      ctx.wander.moodIdle = m.id;
      ctx.alive.express(EXPRESSION_FOR[m.id], 8);
      // `halt` re-picks an idle through the mood, so the change is immediate
      // rather than waiting for whatever he is doing to finish.
      ctx.wander.halt();
      ctx.shell.toast(m.note);
      ctx.shell.refresh();
    },
    el('div.swatch', {}, icon('mood', 20)),
    el('div.label', {}, m.name)))),
});

const EMOTES: { name: string; expression?: ExpressionName; clip?: string; note: string }[] = [
  { name: 'Wave', clip: 'waving', note: 'Hello then' },
  { name: 'Amused', expression: 'amused', note: '' },
  { name: 'Doubtful', expression: 'doubtful', note: '' },
  { name: 'Surprised', expression: 'surprised', note: '' },
  { name: 'Thinking', expression: 'thinking', note: '' },
  { name: 'Listening', expression: 'listening', note: '' },
];

export const emotes = (ctx: UiContext): Screen => ({
  id: 'emotes',
  // Close: an expression at full length reads as nothing at all.
  shot: 'portrait',

  head: () => el('div', { style: 'display:flex;align-items:center;gap:12px;width:100%' },
    button('chip.glass', () => ctx.shell.back(), icon('back', 20)),
    el('div.title', {}, 'Emotes'),
    el('div.spring'),
    button('chip.glass', () => ctx.shell.go('camera'), icon('photos', 19))),

  tray: () => el('div', { style: 'display:grid;gap:10px' },
    el('div.scroll', {}, ...EMOTES.map((e) =>
      button('tile.glass', () => {
        if (e.clip && ctx.colin.clips.includes(e.clip)) ctx.poses.play(e.clip);
        if (e.expression) ctx.alive.express(e.expression, 3.5);
        ctx.alive.blinkNow();
        if (e.note) ctx.shell.toast(e.note);
      },
      el('div.swatch', {}, icon(e.clip ? 'emotes' : 'mood', 20)),
      el('div.label', {}, e.name)))),
    button('action.quiet', () => {
      ctx.alive.express('neutral', 0);
      ctx.poses.release();
      ctx.shell.toast('Back to normal');
    }, 'Reset his face')),
});
