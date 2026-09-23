// How he looks, with him standing right there while you change it.
//
// Three groups rather than one long list, and that is a framing decision as much
// as a layout one: the tray is the bottom of the screen and everything it takes
// is something you cannot see him in. Four sliders is the most that can sit
// under him without the thing being adjusted disappearing behind the adjustment.
//
// Every number here is remembered and survives changing rooms — see `look.ts`,
// where the room sets the baseline and this sets the taste on top of it.
import { el, icon, button, slider } from '../dom';
import type { LookConfig } from '../../look';
import type { UiContext } from '../context';
import type { Screen } from '../shell';

interface Knob {
  key: keyof LookConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Multipliers read as percentages; absolutes read as themselves. */
  percent?: boolean;
}

const GROUPS: { id: string; name: string; knobs: Knob[] }[] = [
  {
    id: 'light',
    name: 'Light',
    knobs: [
      { key: 'brightness', label: 'Brightness', min: 0.4, max: 2, step: 0.01, percent: true },
      { key: 'key', label: 'Key light', min: 0, max: 3, step: 0.01, percent: true },
      { key: 'fill', label: 'Fill light', min: 0, max: 3, step: 0.01, percent: true },
      { key: 'rim', label: 'Rim light', min: 0, max: 3, step: 0.01, percent: true },
    ],
  },
  {
    id: 'surface',
    name: 'Surface',
    knobs: [
      { key: 'roughness', label: 'Roughness', min: 0.05, max: 1, step: 0.01 },
      /* Up to 400%, because the default is 250 and a slider whose default sits
         on its own end stop is a slider that only goes down. */
      { key: 'emission', label: 'Emission', min: 0, max: 4, step: 0.01, percent: true },
      { key: 'environment', label: 'Environment', min: 0, max: 2.5, step: 0.01, percent: true },
    ],
  },
  {
    id: 'colour',
    name: 'Colour',
    knobs: [
      { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01 },
      { key: 'backdrop', label: 'Backdrop', min: 0.15, max: 1.6, step: 0.01, percent: true },
    ],
  },
];

export const look = (ctx: UiContext): Screen => {
  let group = sessionStorage.getItem('colin.ui.lookGroup') ?? GROUPS[0].id;
  if (!GROUPS.some((g) => g.id === group)) group = GROUPS[0].id;

  const pick = (id: string) => {
    group = id;
    sessionStorage.setItem('colin.ui.lookGroup', id);
    ctx.shell.refresh();
  };

  return {
    id: 'look',
    // Head to toe: his face, his clothes and the floor he is lit against are all
    // things these knobs change, and judging any of them by his forehead alone
    // is how a character ends up looking right in one shot and nowhere else.
    shot: 'full',

    enter: () => { ctx.poses.play('idle_neutral'); },
    exit: () => { ctx.poses.release(); },

    /* Reset lives in the header rather than the tray, because the tray is the
       thing competing with him for the screen and this is a button pressed once
       a session at most. It is always drawn, never conditional on anything
       having changed: showing it only when something has moved would mean
       rebuilding the screen from inside a slider's own `input` handler, which
       destroys the slider the thumb is on. */
    head: () => el('div', { style: 'display:flex;align-items:center;gap:12px;width:100%' },
      button('chip.glass', () => ctx.shell.back(), icon('back', 20)),
      el('div.title', {}, 'Look'),
      el('div.spring'),
      button('text', () => {
        ctx.look.reset();
        ctx.shell.toast('Back to how he ships');
        ctx.shell.refresh();
      }, 'Reset'),
      button('chip.glass', () => ctx.shell.go('camera'), icon('photos', 19))),

    tray: () => {
      const tabs = el('div.segments.glass', {}, ...GROUPS.map((g) =>
        button(`${group === g.id ? 'on' : ''}`, () => pick(g.id), g.name)));

      const knobs = GROUPS.find((g) => g.id === group)!.knobs;
      const panel = el('div.glass', { style: 'border-radius:19px;padding:4px 2px' },
        ...knobs.map((knob) => slider({
          label: knob.label,
          value: ctx.look.config[knob.key],
          min: knob.min,
          max: knob.max,
          step: knob.step,
          format: knob.percent ? (v) => `${Math.round(v * 100)}%` : (v) => v.toFixed(2),
          /* `apply` and nothing else. Anything that rebuilds the screen from in
             here replaces the element the thumb is being dragged on, and the
             drag ends on the frame it started. */
          onInput: (value) => {
            ctx.look.config[knob.key] = value;
            ctx.look.apply();
          },
        })));

      return el('div', { style: 'display:grid;gap:9px' }, tabs, panel);
    },
  };
};
