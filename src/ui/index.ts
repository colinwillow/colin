// Mounting the interface.
//
// One import from `main.ts`, which keeps the render loop and the app that
// surrounds it from growing into each other: everything here reaches the scene
// through the context object and nothing in the scene knows this exists.
import './ui.css';
import { createShell, type ScreenFactory, type Shell } from './shell';
import type { UiContext } from './context';
import { stage } from './screens/stage';
import { home } from './screens/home';
import { outfits } from './screens/outfits';
import { poses } from './screens/poses';
import { mood, emotes } from './screens/mood';
import { look } from './screens/look';
import { rooms } from './screens/rooms';
import { camera } from './screens/camera';
import { gallery } from './screens/gallery';
import { more } from './screens/more';

const SCREENS: Record<string, ScreenFactory> = {
  stage, home, outfits, poses, mood, emotes, rooms, look, camera, gallery, more,
};

export type { UiContext } from './context';

export function createInterface(context: Omit<UiContext, 'shell'>): Shell {
  const root = document.createElement('div');
  root.id = 'ui';
  document.body.appendChild(root);
  return createShell(root, SCREENS, context);
}
