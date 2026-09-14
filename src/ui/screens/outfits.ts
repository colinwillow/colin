// What he is wearing, one slot at a time.
//
// The rail is the model's own slots, not a fixed list — an empty one is still
// shown, because the useful thing to say about a slot with nothing in it is what
// to name the mesh that would fill it.
import { el, icon, button } from '../dom';
import type { UiContext } from '../context';
import type { Screen } from '../shell';

const SLOT_ICON: Record<string, string> = {
  top: 'outfits', bottom: 'outfits', shoes: 'poses', hat: 'mood',
  headphones: 'emotes', jacket: 'outfits', other: 'more',
};

export const outfits = (ctx: UiContext): Screen => {
  let slot = ctx.wardrobe.slots[0]?.id ?? 'top';
  /* Reopening on the same slot you left is the difference between a wardrobe and
     a form: it survives leaving the screen, because trying a jacket usually
     means trying three. */
  const remembered = sessionStorage.getItem('colin.ui.slot');
  if (remembered && ctx.wardrobe.slots.some((s) => s.id === remembered)) slot = remembered;

  const pick = (id: string) => {
    slot = id;
    sessionStorage.setItem('colin.ui.slot', id);
    ctx.shell.refresh();
  };

  return {
    id: 'outfits',
    shot: 'full',

    // Standing still and facing front, because this screen is a fitting room.
    enter: () => { ctx.poses.play('idle_neutral'); },
    exit: () => { ctx.poses.release(); },

    head: () => el('div', { style: 'display:flex;align-items:center;gap:12px;width:100%' },
      button('chip.glass', () => ctx.shell.back(), icon('back', 20)),
      el('div.title', {}, 'Outfits'),
      el('div.spring'),
      button('chip.glass', () => ctx.shell.go('camera'), icon('photos', 19))),

    body: () => [
      el('div.spring'),
      el('div#rail', {}, ...ctx.wardrobe.slots.map((s) => {
        const count = ctx.wardrobe.itemsIn(s.id).length;
        return button(`glass${slot === s.id ? '.on' : ''}`,
          () => pick(s.id),
          icon(SLOT_ICON[s.id] ?? 'outfits', 19),
          el('span', {}, s.name),
          count ? null : el('span', { style: 'opacity:.5;font-size:9px' }, '—'));
      })),
    ],

    tray: () => {
      const items = ctx.wardrobe.itemsIn(slot);
      const definition = ctx.wardrobe.slots.find((s) => s.id === slot);
      if (!items.length) {
        return el('div.empty', {},
          `Nothing in ${definition?.name.toLowerCase() ?? 'this slot'} yet. `,
          'Export a mesh named ',
          el('code', {}, `${slot}_something`),
          ' and it turns up here.');
      }
      const worn = ctx.wardrobe.wornIn(slot);
      const tile = (id: string | null, name: string, glyph: string) =>
        button(`tile.glass${worn === id ? '.on' : ''}`, () => { ctx.wardrobe.wear(slot, id); ctx.shell.refresh(); },
          el('div.swatch', {}, icon(glyph, 20)),
          el('div.label', {}, name));
      return el('div.scroll', {},
        ...(definition?.optional ? [tile(null, 'None', 'close')] : []),
        ...items.map((item) => tile(item.id, item.name, SLOT_ICON[slot] ?? 'outfits')));
    },
  };
};
