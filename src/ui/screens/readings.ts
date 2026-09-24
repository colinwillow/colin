// Him reading something out loud.
//
// The transport is on a screen rather than in the conversation because a
// twenty-minute essay is a thing you start and then go and look at him during —
// so leaving here does NOT stop it. That is the one decision in this file worth
// arguing about, and the argument is that a reading is not a screen, it is
// something he is doing; walking off to change his jacket while he reads is a
// reasonable thing to want.
import { el, icon, button, slider } from '../dom';
import type { UiContext } from '../context';
import type { Screen } from '../shell';

const mmss = (s: number) => {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export const readings = (ctx: UiContext): Screen => {
  let asked = false;
  /** Held so the scrubber can be moved by the playback without rebuilding the
   *  screen — which would replace the element a thumb is on. */
  let bar: (HTMLInputElement & { readout?: HTMLElement }) | null = null;
  let dragging = false;
  /** Redrawn only when the play/pause state changes, rather than every frame. */
  let wasPlaying: boolean | null = null;

  return {
    id: 'readings',
    // Chest up. He is talking and not doing anything with his feet.
    shot: 'half',

    enter: () => {
      if (asked) return;
      asked = true;
      void ctx.narration.load().then(() => ctx.shell.refresh());
    },

    update: () => {
      const playing = ctx.narration.playing;
      if (wasPlaying !== null && playing !== wasPlaying) { wasPlaying = playing; ctx.shell.refresh(); return; }
      wasPlaying = playing;
      if (!bar || dragging || !ctx.narration.reading) return;
      const at = ctx.narration.at();
      bar.value = String(at);
      if (bar.readout) bar.readout.textContent = `${mmss(at)} / ${mmss(ctx.narration.reading.duration)}`;
    },

    head: () => el('div', { style: 'display:flex;align-items:center;gap:12px;width:100%' },
      button('chip.glass', () => ctx.shell.back(), icon('back', 20)),
      el('div.title', {}, 'Readings'),
      el('div.spring'),
      ctx.narration.reading
        ? button('text', () => { ctx.narration.stop(); ctx.shell.refresh(); }, 'Stop')
        : el('span')),

    tray: () => {
      const list = ctx.narration.readings;
      if (!list.length) {
        /* On a panel, not floating. The empty states elsewhere sit inside a
           tray that already has a surface under it; this one is the whole tray,
           and dark text with a live 3D view behind it is not text. */
        return el('div.glass', { style: 'border-radius:19px;padding:2px' },
          el('div.empty', { style: 'border:0' },
            'Nothing recorded yet. ',
            el('code', {}, 'npm run bake-narration -- essays/yours.md --dry'),
            ' costs nothing and tells you what the real one would.'));
      }

      const row = el('div.scroll', {}, ...list.map((r) =>
        button(`tile.glass${ctx.narration.reading?.id === r.id ? '.on' : ''}`,
          () => { void ctx.narration.play(r.id).then(() => ctx.shell.refresh()); ctx.shell.refresh(); },
          el('div.swatch', {}, icon('read', 20)),
          el('div.label', {}, r.title))));

      const now = ctx.narration.reading;
      if (!now) {
        return el('div', { style: 'display:grid;gap:9px' },
          row,
          el('div.reading', {}, 'Pick one. It carries on if you go and look at him.'));
      }

      const scrub = el('div.glass', { style: 'border-radius:19px;padding:4px 2px' },
        slider({
          label: now.title,
          value: ctx.narration.at(),
          min: 0,
          max: Math.max(1, now.duration),
          step: 1,
          format: (v) => `${mmss(v)} / ${mmss(now.duration)}`,
          ref: (input) => {
            bar = input as HTMLInputElement & { readout?: HTMLElement };
            /* A drag has to stop the playback writing to the same element, or
               the thumb is dragged back under the finger every frame. */
            for (const down of ['pointerdown', 'touchstart']) input.addEventListener(down, () => { dragging = true; });
            for (const up of ['pointerup', 'pointercancel', 'touchend']) {
              input.addEventListener(up, () => { window.setTimeout(() => { dragging = false; }, 60); });
            }
          },
          // Nothing: the readout moves itself, and seeking on every step of a
          // drag would refetch and re-decode audio a hundred times.
          onInput: () => {},
          onChange: (value) => { void ctx.narration.seek(value); },
        }),
        el('div.reading', {}, now.voice, now.words ? ` · ${now.words.toLocaleString()} words` : ''));

      const playing = ctx.narration.playing;
      const transport = el('div.pills', {},
        button('action.quiet', () => {
          void ctx.narration.seek(Math.max(0, ctx.narration.at() - 15));
        }, icon('back', 18), '15s'),
        button('action', () => {
          if (playing) ctx.narration.pause();
          else void ctx.narration.resume();
          ctx.shell.refresh();
        }, icon(playing ? 'hold' : 'play', 18), playing ? 'Pause' : 'Play'));

      return el('div', { style: 'display:grid;gap:9px' }, row, scrub, transport);
    },
  };
};
