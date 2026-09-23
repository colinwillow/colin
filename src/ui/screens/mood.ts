// Two screens that are easy to confuse and are not the same thing.
//
//   Mood   — what he is like right now. It picks which idle he falls into and
//            what his face sits at, and it stays until something changes it.
//   Emotes — one thing, once. A wave, a raised brow, a blink.
//
// The mood is TWO SLIDERS and six shortcuts to positions on them, rather than
// six buttons — see mood.ts for why there are two axes. The sliders are the
// honest interface, because the conversation moves the same two numbers by
// small amounts all the time: what the panel shows is a reading, and dragging
// it is reaching into the same dial he is already turning. The presets are there
// because nobody wants to find "cross" by feel.
//
// Both are trays rather than full screens, because the whole point of pressing
// "amused" is watching his face do it.
import { el, icon, button, slider } from '../dom';
import type { Mood } from '../../mood';
import { EXPRESSION_FOR, PRESETS, nameFor } from '../../mood';
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

/** How the two numbers read out. −1…1 is honest and means nothing to anybody;
 *  a word and a percentage is the same number said usefully. */
const readValence = (v: number) => (Math.abs(v) < 0.12 ? 'level'
  : `${v > 0 ? 'good' : 'bad'} ${Math.round(Math.abs(v) * 100)}%`);
const readEnergy = (v: number) => (Math.abs(v) < 0.12 ? 'steady'
  : `${v > 0 ? 'up' : 'down'} ${Math.round(Math.abs(v) * 100)}%`);

export const mood = (ctx: UiContext): Screen => ({
  id: 'mood',
  // Chest up: a mood is mostly a face, and his idle carries the rest.
  shot: 'half',

  head: () => el('div', { style: 'display:flex;align-items:center;gap:12px;width:100%' },
    button('chip.glass', () => ctx.shell.back(), icon('back', 20)),
    el('div.title', {}, 'Mood'),
    el('div.spring'),
    button('text', () => {
      ctx.feelings.set({ valence: 0, energy: 0, topic: null });
      ctx.wander.halt();
      ctx.shell.toast('Back to level');
      ctx.shell.refresh();
    }, 'Level')),

  tray: () => {
    /* The presets light up by PROXIMITY rather than by being the last one
       pressed. The conversation is moving these numbers between visits, so
       "which button is on" is a question about where he has drifted to, and a
       preset that stays lit while he has gone somewhere else is a lie. */
    const near = (m: Mood) => Math.abs(PRESETS[m].valence - ctx.feelings.valence) < 0.16
      && Math.abs(PRESETS[m].energy - ctx.feelings.energy) < 0.2;

    const now = el('div.reading', {},
      'He is ', el('b', {}, nameFor(ctx.feelings)),
      ctx.feelings.topic ? `, thinking about being ${ctx.feelings.topic}.` : '.');

    const dials = el('div.glass', { style: 'border-radius:19px;padding:4px 2px' },
      slider({
        label: 'Mood',
        value: ctx.feelings.valence,
        min: -1,
        max: 1,
        step: 0.01,
        format: readValence,
        /* `set` and nothing else. Rebuilding the screen from inside a slider's
           own input handler replaces the element the thumb is on, and the drag
           ends on the frame it started — see the same note on the Look panel. */
        onInput: (value) => { ctx.feelings.set({ valence: value }); },
      }),
      slider({
        label: 'Energy',
        value: ctx.feelings.energy,
        min: -1,
        max: 1,
        step: 0.01,
        format: readEnergy,
        onInput: (value) => { ctx.feelings.set({ energy: value }); },
      }),
      now);

    /* What he has drifted to, in a word. Worth showing because the sliders are
       not the only thing moving these numbers — most of the time the
       conversation is — and the reading is how you tell the difference between
       a preset being on and him having wandered back toward level. */
    /* Inside the panel rather than under it: floating text over a live 3D view
       lands on whatever he happens to be standing on, and this one was sitting
       across his shoe. It also belongs with the numbers it is describing. */
    const row = el('div.scroll', {}, ...MOODS.map((m) =>
      button(`tile.glass${near(m.id) ? '.on' : ''}`, () => {
        /* A mood and a held pose are both answers to "what is he doing", so one
           has to give: picking a mood hands him back to his own idles. */
        ctx.poses.release();
        ctx.feelings.set(PRESETS[m.id]);
        ctx.alive.express(EXPRESSION_FOR[m.id], 8);
        // `halt` re-picks an idle through the mood, so the change is immediate
        // rather than waiting for whatever he is doing to finish.
        ctx.wander.halt();
        ctx.shell.toast(m.note);
        ctx.shell.refresh();
      },
      el('div.swatch', {}, icon('mood', 20)),
      el('div.label', {}, m.name))));

    return el('div', { style: 'display:grid;gap:9px' }, dials, row);
  },
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
