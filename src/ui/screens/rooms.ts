// Where he is standing.
//
// A tray rather than a list screen, and deliberately: the whole value of a
// backdrop is what it does to him, and a full-screen picker hides the one thing
// you are choosing between. Flick along the row and the room changes underneath.
import { el, icon, button } from '../dom';
import type { StageScene } from '../../stage';
import type { UiContext } from '../context';
import type { Screen } from '../shell';

/** The swatch: the same sweep the scene actually builds, as a CSS gradient. */
function preview(scene: StageScene): string {
  if (scene.kind === 'room') {
    // The kitchen is a photograph, not a colour — this is the light in it.
    return 'linear-gradient(165deg, #f0d9b4 0%, #c8a06a 42%, #4b3b2c 100%)';
  }
  const c = scene.backdrop!.color;
  return `linear-gradient(180deg, color-mix(in srgb, ${c} 78%, white) 0%, ${c} 58%, `
    + `color-mix(in srgb, ${c} 72%, black) 100%)`;
}

export const rooms = (ctx: UiContext): Screen => {
  const note = el('div.sub', {}, ctx.stage.current.note);

  return {
    id: 'rooms',
    // Further back than the other screens: a room you cannot see any of is not
    // a room, it is a colour behind his head.
    shot: 'wide',

    enter: () => { ctx.poses.play('idle_neutral'); },
    exit: () => { ctx.poses.release(); },

    head: () => el('div', { style: 'display:flex;align-items:center;gap:12px;width:100%' },
      button('chip.glass', () => ctx.shell.back(), icon('back', 20)),
      el('div', {}, el('div.title', {}, 'Rooms'), note),
      el('div.spring'),
      button('chip.glass', () => ctx.shell.go('camera'), icon('photos', 19))),

    tray: () => el('div.scroll', {},
      ...ctx.stage.scenes.map((scene) => button(
        `tile.glass${ctx.stage.current.id === scene.id ? '.on' : ''}`,
        () => {
          ctx.stage.go(scene.id);
          /* The kitchen is the only one he can walk around in, and walking is
             the wrong thing to be doing while somebody is picking rooms — so he
             stands still here whatever the room says, and gets it back on the
             way out. */
          ctx.poses.play('idle_neutral');
          note.textContent = scene.note;
          ctx.shell.refresh();
        },
        el('div.swatch', { style: `background: ${preview(scene)}` }),
        el('div.label', {}, scene.name))),
      /* Honest placeholder. There is no room-importing anything yet: the next
         one is a Blender bake and an entry in SCENES, and saying so is more use
         than a button that pretends otherwise. */
      button('tile.glass', () => ctx.shell.toast('The next room gets built in Blender'),
        el('div.swatch', {}, icon('plus', 20)),
        el('div.label', {}, 'Add')),
    ),
  };
};
