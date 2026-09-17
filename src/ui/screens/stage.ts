// Him, and nothing else.
//
// This is the screen the app is actually for, and it is almost entirely empty on
// purpose. Everything the last pass built — the hub, the slot rails, the trays —
// is a workshop you go into deliberately and come back out of; this is the room,
// with a man in it, and the only things over the top of it are the two you need
// to hold a conversation: something to talk with, and something to read if you
// missed what he said.
//
// One chip in the corner is the entire way in to the rest. A tab bar along the
// bottom makes it an app with a character in it, and the point is the other way
// round.
import type { UiContext } from '../context';
import type { Screen } from '../shell';

export const stage = (ctx: UiContext): Screen => ({
  id: 'stage',
  /* The bare dock — the microphone and one way out, with no panel behind them.
     The shell builds it; there is nothing for this screen to add. */
  chrome: 'bare',
  // Whatever the room he is in wants, which in the kitchen is no framing at all:
  // the camera goes back on the rig and he walks around.
  shot: ctx.stage.current.shot,

  enter: () => {
    /* Nothing held, nothing posed, no expression parked on his face. Coming back
       here means coming back to HIM, rather than to the last thing that was
       being tried on him. */
    ctx.poses.release();
    ctx.alive.express('neutral', 0);
    ctx.alive.lookAt(null);
  },
});
