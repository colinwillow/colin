// Colin walking around the kitchen on his own.
//
// The walk clips carry no net root motion — measured, `walk_fwd_normal` drifts
// 0.0 units over its length — so they are in-place cycles and the position is
// ours to drive. That is the easy case: no root-motion extraction, and the
// walk speed is a number we pick rather than one baked into the clip.
import * as THREE from 'three';
import type { Character } from './character';

export interface WanderArea {
  /** Floor rectangle he keeps inside, in world metres. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface WanderConfig {
  enabled: boolean;
  area: WanderArea;
  /** Metres per second. Too fast and his feet skate, since nothing ties the
   *  clip's stride to the distance covered. */
  speed: number;
  /** Degrees per second while turning on the spot. */
  turnSpeed: number;
  /** How long he stands around between walks, in seconds. */
  pauseMin: number;
  pauseMax: number;
  /** He never turns his back further than this from the camera, so a
   *  conversation partner stays a conversation partner. */
  maxFacingAwayDeg: number;
}

export const DEFAULT_WANDER: WanderConfig = {
  enabled: true,
  // The open strip of floor: clear of the counters on both walls, the stove
  // behind him and the doorway. Roughly where the runner rug is.
  area: { minX: -1.15, maxX: 0.55, minZ: 1.25, maxZ: 3.6 },
  speed: 0.62,
  turnSpeed: 120,
  pauseMin: 4,
  pauseMax: 11,
  maxFacingAwayDeg: 115,
};

type Phase = 'idle' | 'turning' | 'walking';

export interface Wander {
  update: (dt: number) => void;
  config: WanderConfig;
  /** Stop where he is and return to an idle. Used when he starts talking. */
  halt: () => void;
  readonly phase: Phase;
  readonly target: THREE.Vector3;
}

/** Shortest signed angle from a to b, in radians. */
function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

export function createWander(
  colin: Character,
  config: WanderConfig = { ...DEFAULT_WANDER, area: { ...DEFAULT_WANDER.area } },
): Wander {
  const idles = colin.clips.filter((c) => /^idle_(neutral|happy|stretch|look|fan)/.test(c));
  const walk = colin.clips.find((c) => c === 'walk_fwd_normal') ?? colin.clips.find((c) => c.startsWith('walk'));

  let phase: Phase = 'idle';
  let wait = 2;
  const target = colin.root.position.clone();
  let facing = colin.root.rotation.y;

  const pickIdle = () => idles[Math.floor(Math.random() * idles.length)] ?? colin.clips[0];
  const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

  const chooseTarget = () => {
    const a = config.area;
    // A few tries to find somewhere far enough away to be worth walking to.
    for (let i = 0; i < 12; i++) {
      const p = new THREE.Vector3(rand(a.minX, a.maxX), 0, rand(a.minZ, a.maxZ));
      if (p.distanceTo(colin.root.position) > 0.55) return p;
    }
    return null;
  };

  const faceOf = (to: THREE.Vector3) => {
    const d = to.clone().sub(colin.root.position);
    // He models facing +z, so yaw is measured from that axis.
    return Math.atan2(d.x, d.z);
  };

  /** Keep him from presenting his back to the camera, which sits at +z. */
  const withinFacingLimit = (yaw: number) => {
    const away = Math.abs(THREE.MathUtils.radToDeg(angleDelta(0, yaw)));
    return away <= config.maxFacingAwayDeg;
  };

  const halt = () => {
    phase = 'idle';
    wait = rand(config.pauseMin, config.pauseMax);
    colin.play(pickIdle());
  };

  const update = (dt: number) => {
    if (!config.enabled) return;

    if (phase === 'idle') {
      wait -= dt;
      if (wait > 0) return;
      const next = chooseTarget();
      if (!next) { wait = 1; return; }
      const yaw = faceOf(next);
      if (!withinFacingLimit(yaw)) { wait = 0.5; return; }
      target.copy(next);
      facing = yaw;
      phase = 'turning';
      return;
    }

    const turn = angleDelta(colin.root.rotation.y, facing);
    if (phase === 'turning') {
      const step = THREE.MathUtils.degToRad(config.turnSpeed) * dt;
      if (Math.abs(turn) <= step) {
        colin.root.rotation.y = facing;
        phase = 'walking';
        if (walk) colin.play(walk, 0.25);
      } else {
        colin.root.rotation.y += Math.sign(turn) * step;
        // Turning on the spot reads better with the feet moving.
        if (walk) colin.play(walk, 0.3);
      }
      return;
    }

    // walking
    const toTarget = target.clone().sub(colin.root.position);
    toTarget.y = 0;
    const distance = toTarget.length();
    if (distance < 0.06) { halt(); return; }
    // Keep steering, so a target chosen mid-turn is still reached cleanly.
    colin.root.rotation.y += THREE.MathUtils.clamp(
      turn, -THREE.MathUtils.degToRad(config.turnSpeed) * dt, THREE.MathUtils.degToRad(config.turnSpeed) * dt,
    );
    facing = faceOf(target);
    colin.root.position.addScaledVector(toTarget.normalize(), Math.min(config.speed * dt, distance));
  };

  colin.play(pickIdle(), 0);
  return { update, config, halt, get phase() { return phase; }, get target() { return target; } };
}
