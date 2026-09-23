// How he looks, as a set of knobs that survive changing rooms.
//
// The problem this solves is an ordering one. `stage.ts` writes exposure,
// emission, environment and the three light intensities every time the room
// changes, because a baked kitchen and a white sweep want nothing like the same
// numbers. So anything adjusted by hand was correct until the next room and then
// silently gone.
//
// THE ROOM SETS THE BASELINE AND THIS SETS THE TASTE. Every knob here except two
// is a MULTIPLIER on whatever the scene asked for, so "a bit brighter" stays a
// bit brighter in the kitchen, in the studio and in anything added later. The two
// that are absolute are the two no scene has an opinion about: how rough his
// surface is, and how saturated.
//
// Everything is remembered. These are preferences — the answer to "what do I want
// him to look like" does not change between sessions.
import * as THREE from 'three';
import type { Character, CharacterLights } from './character';
import type { Toon } from './toon';

export interface LookConfig {
  /** Multiplies the room's exposure for his pass. The main brightness knob. */
  brightness: number;
  /** Multiplies the room's emission — his diffuse map fed back as light. */
  emission: number;
  /** Multiplies how much of the room's probe lands on him. */
  environment: number;
  /** Absolute. The scene has no opinion about this; the model does. */
  roughness: number;
  /** Absolute. 1 is the texture as painted, 0 is grey, 2 is twice as vivid. */
  saturation: number;
  /** Multiply the room's three-point rig. */
  key: number;
  fill: number;
  rim: number;
  /** How bright the backdrop itself is, and the light it throws with it. */
  backdrop: number;
}

/* DIALLED IN ON A PHONE, ON THE PAPER BACKDROP, AND THEN WRITTEN DOWN. Not a
   set of neutral ones: the neutral version of this is what the scene table says,
   and the scene table was tuned against a dark baked kitchen where he needed
   almost none of this. Standing on a pale sweep he wants nearly three times the
   key, half again the fill, and a surface that is a good deal less matte than a
   room with no direct light in it ever showed. */
export const DEFAULT_LOOK: LookConfig = {
  brightness: 1.2,
  emission: 2.5,
  environment: 1.1,
  roughness: 0.8,
  saturation: 1.1,
  key: 2.68,
  fill: 1.75,
  rim: 1.41,
  backdrop: 1.29,
};

/** What the current room asked for, before any of this is applied. */
export interface LookBase {
  exposure: number;
  emissiveIntensity: number;
  envMapIntensity: number;
  key: number;
  fill: number;
  rim: number;
}

export interface Look {
  config: LookConfig;
  /** The room's numbers. Called by `stage.ts` on every change of scene. */
  setBase: (base: LookBase) => void;
  /** Write the config onto the materials, the lights and the tone curve. */
  apply: () => void;
  /** Back to the model's own values and the room's own numbers. */
  reset: () => void;
  /** What the model shipped with, so "reset" means something. */
  readonly shipped: LookConfig;
}

export interface LookParts {
  colin: Character;
  lights: CharacterLights;
  /** His pass's tone curve, which the render loop reads every frame. */
  curve: { exposure: number };
  /** The scene he is lit by, for the probe's overall level. */
  characterScene: THREE.Scene;
  /** The backdrop sphere's material, so the sweep can be dimmed with it. */
  sky: THREE.MeshBasicMaterial;
  /** The one patch on his materials — see the note in toon.ts. */
  toon: Toon;
}

/* BUMPED WHEN THE DEFAULTS CHANGE, and that is the whole reason it carries a
   number. These are remembered, so a new default lands on a device that has
   never run the app and on no other one — the saved object wins every key it
   has, which is every key. Changing the table without changing this is a change
   that ships to nobody who has already used it. */
const KEY = 'colin.look.v2';

export function createLook(parts: LookParts): Look {
  const { colin, lights, curve, characterScene, sky, toon } = parts;

  /* The table above, exactly. It used to read roughness off the model instead,
     on the grounds that the export is the authority — and that was right while
     these were neutral placeholders and wrong the moment they became somebody's
     answer. "Reset" means "back to the look that was chosen", not "back to
     whatever number happens to be in the GLB". */
  const shipped: LookConfig = { ...DEFAULT_LOOK };

  const config: LookConfig = { ...shipped };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<LookConfig> | null;
    if (saved) {
      // Only keys that still exist, and only numbers: a stale saved object from
      // an older build must not be able to write a string into a uniform.
      for (const key of Object.keys(shipped) as (keyof LookConfig)[]) {
        if (typeof saved[key] === 'number' && Number.isFinite(saved[key])) config[key] = saved[key];
      }
    }
  } catch { /* no storage; his own numbers it is */ }

  /* A baseline until the stage says otherwise, so this is safe to apply before
     the first room has been chosen. */
  let base: LookBase = {
    exposure: curve.exposure,
    emissiveIntensity: colin.materials[0]?.emissiveIntensity ?? 0.72,
    envMapIntensity: colin.materials[0]?.envMapIntensity ?? 1,
    key: lights.key.intensity,
    fill: lights.fill.intensity,
    rim: lights.rim.intensity,
  };

  const apply = () => {
    curve.exposure = base.exposure * config.brightness;
    for (const material of colin.materials) {
      material.emissiveIntensity = base.emissiveIntensity * config.emission;
      material.envMapIntensity = base.envMapIntensity * config.environment;
      material.roughness = THREE.MathUtils.clamp(config.roughness, 0.02, 1);
    }
    lights.key.intensity = base.key * config.key;
    lights.fill.intensity = base.fill * config.fill;
    lights.rim.intensity = base.rim * config.rim;

    toon.setGrade({ saturation: config.saturation });

    /* The backdrop and the light it throws move together, because on a
       cyclorama they are the same thing: dimming the wall without dimming what
       bounces off it is a photograph of a dark wall with a brightly lit man in
       front of it. */
    sky.color.setScalar(config.backdrop);
    characterScene.environmentIntensity = config.backdrop;

    try { localStorage.setItem(KEY, JSON.stringify(config)); }
    catch { /* private mode: it lasts the session */ }
  };

  return {
    config,
    shipped,
    setBase: (next) => { base = next; apply(); },
    apply,
    reset: () => { Object.assign(config, shipped); apply(); },
  };
}
