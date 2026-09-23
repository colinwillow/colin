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
import type { Feelings } from '../mood';
import type { Wardrobe } from '../wardrobe';
import type { Camera } from '../photos';
import type { Toon } from '../toon';
import type { Look } from '../look';
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
  /** How he is feeling, as two numbers with inertia. The Mood screen drives it
   *  by hand; the conversation drives it by itself. */
  feelings: Feelings;
  wardrobe: Wardrobe;
  camera: Camera;
  /** The cel-shading experiment. `toon.config.amount` is the whole switch. */
  toon: Toon;
  /** Brightness, emission, roughness, saturation — his look on top of the room's. */
  look: Look;
  /** Driver facts worth being able to read on the device itself. */
  capabilities: Record<string, string>;
  /** Toggles the developer tuning panel. */
  tuning: (on?: boolean) => boolean;
  shell: Shell;
}
