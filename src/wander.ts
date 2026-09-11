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
  /* The open floor he can cross AND still be seen on.
   *
   * The camera is at z 4.9, so a BIGGER z is nearer the lens, and the old
   * rectangle ran to 3.6 — a metre and a third from a 74° lens. Measured across
   * that rectangle, his head projected to ndcX 1.6 at the near corners: fully off
   * the side of the screen, with his feet off the bottom, and the wide-angle
   * stretch in the corner blowing his head up to something grotesque. Past z 3.05
   * there was no x at all where he fitted in frame. It only started showing up
   * once the walk targets got far enough apart to actually reach the corners.
   *
   * These bounds are measured rather than guessed: the floor is clear of the
   * counters and the stove across all of it (raycast, since the GLB is merged by
   * material and bounding boxes span the room), and at every corner he is whole
   * in frame on both a portrait phone and a landscape desktop — the desktop is
   * what caps the near edge, since his feet leave the bottom there first.
   *
   * The width is what the camera bought. It could not be had before: A fixed shot can only cover the strip the Blender framing points at,
   * so the rectangle was a rug-width corridor and he spent his time pacing it.
   * The limit was never the floor — the clear floor runs from x -2.25 to +2.0 —
   * it was that anything outside the frame may as well not exist. With the rig
   * panning up to 18° he can use the width, and the near edge is still what
   * caps the depth, since that is a matter of his feet leaving the bottom of a
   * landscape frame and no amount of panning fixes it.
   *
   * Every bound is his SHOULDERS, not his centre. The clear floor runs to -2.25
   * and +1.0 here, but he is about 0.6 m across, so walking his origin to the
   * edge of the clear floor puts an arm through a cabinet — and the far edge is
   * 1.2 rather than 1.0 for the same reason, checked by sampling the floor at
   * four points around him instead of one underneath him: at 1.0 he had his
   * shoulder in the stove. */
  area: { minX: -1.95, maxX: 0.65, minZ: 1.2, maxZ: 2.0 },
  speed: 0.62,
  turnSpeed: 120,
  // He was standing 12-13 seconds between two-second walks, which on a phone
  // means you almost always catch him standing still and conclude he is idle.
  pauseMin: 2,
  pauseMax: 5.5,
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
    // Far enough away to be worth walking to: short hops read as fidgeting, and
    // at 0.62 m/s a half-metre target is over before it registers.
    let best: THREE.Vector3 | null = null;
    let bestDistance = 0;
    for (let i = 0; i < 16; i++) {
      const p = new THREE.Vector3(rand(a.minX, a.maxX), 0, rand(a.minZ, a.maxZ));
      const d = p.distanceTo(colin.root.position);
      if (d > 1.1) return p;
      // Nothing far enough: keep the furthest rather than standing there.
      if (d > bestDistance) { best = p; bestDistance = d; }
    }
    return bestDistance > 0.5 ? best : null;
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
      // Retry immediately rather than standing another half second: this was
      // adding several seconds to pauses that were already too long.
      if (!withinFacingLimit(yaw)) return;
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
