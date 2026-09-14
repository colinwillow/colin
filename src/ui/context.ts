// Everything a screen is allowed to touch, in one object.
//
// Passed down rather than imported, so a screen cannot reach past it into the
// renderer or the scene graph — if something is not here, the screen has no
// business doing it, and adding it is a deliberate act rather than an import.
import type { Character } from '../character';
import type { Alive, FaceRig } from '../face';
import type { Conversation } from '../talk';
import type { Stage } from '../stage';
import type { ShotDirector } from '../shot';
import type { Poses } from '../poses';
import type { Wardrobe } from '../wardrobe';
import type { Camera } from '../photos';
import type { createWander } from '../wander';
import type { Shell } from './shell';

export interface UiContext {
  colin: Character;
  face: FaceRig;
  alive: Alive;
  wander: ReturnType<typeof createWander>;
  talk: Conversation;
  stage: Stage;
  shots: ShotDirector;
  poses: Poses;
  wardrobe: Wardrobe;
  camera: Camera;
  /** Toggles the developer tuning panel. */
  tuning: (on?: boolean) => boolean;
  shell: Shell;
}
