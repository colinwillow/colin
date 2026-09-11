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
  /**
   * Move the turn clip's baked rotation off the hips and onto the root.
   *
   * MUST be called after `character.update`, since the mixer overwrites the
   * hips every frame and this has to read what it wrote and then undo it.
   */
  applyRootMotion: () => void;
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

/**
 * Below this he does not plant a foot and pivot — he just walks the corner.
 * Nobody performs a step-turn to correct twenty degrees, and the walking phase
 * already steers, so small changes of heading come out of the walk itself.
 */
const STEP_TURN_MIN_DEG = 40;

/** If a step turn has not finished in this long, something is wrong with the
 *  clip and the plain rotation takes over rather than leaving him spinning.
 *  A 180 is 1.8 loops of a 0.97s clip, so this has room to spare. */
const STEP_TURN_TIMEOUT = 5;

/**
 * The most one step turn will take, in degrees.
 *
 * The clip delivers 102.6° and then loops, and the loop is a seam: the pose at
 * the end of a pivot is not the pose at the start of one, so the lean jumps in a
 * single frame — measured at 9.8°, roughly seven frames' worth of turn arriving
 * at once. Smoothing it over was tried and was a wash.
 *
 * So never loop it. He pivots one clip's worth and walks the rest of the corner
 * out, which is what a person does anyway: nobody spins 180 on the spot and then
 * sets off, they turn most of the way and curve into the last of it. The walking
 * phase already steers toward the target, so the remainder costs nothing.
 */
const MAX_STEP_TURN_DEG = 95;

/** How long to keep holding the hips after the turn ends. A shade longer than
 *  the cross-fade into the walk, so it outlasts it. */
const SETTLE_SECONDS = 0.35;

export function createWander(
  colin: Character,
  config: WanderConfig = { ...DEFAULT_WANDER, area: { ...DEFAULT_WANDER.area } },
): Wander {
  const idles = colin.clips.filter((c) => /^idle_(neutral|happy|stretch|look|fan)/.test(c));
  const walk = colin.clips.find((c) => c === 'walk_fwd_normal') ?? colin.clips.find((c) => c.startsWith('walk'));
  /* He has proper turn-in-place clips and nothing was using them: a 180° change
     of heading played walk_fwd_normal while the root span, so he moonwalked
     round on the spot. They carry their rotation baked into the HIPS — 102.6°
     over 0.97s, measured — rather than in the root, which is why they cannot
     just be played: the clip would turn him and so would the root, twice over,
     and then snap back when the clip looped. See applyRootMotion. */
  const turnLeft = colin.clips.find((c) => c === 'idle_turn_left');
  const turnRight = colin.clips.find((c) => c === 'idle_turn_right');

  let hips: THREE.Bone | null = null;
  colin.model.traverse((o) => {
    const bone = o as THREE.Bone;
    if (!hips && bone.isBone && /hips/i.test(bone.name)) hips = bone;
  });
  const canStepTurn = !!(hips && turnLeft && turnRight);

  let phase: Phase = 'idle';
  let wait = 2;
  const target = colin.root.position.clone();
  let facing = colin.root.rotation.y;

  /** A step turn in progress: how far round he still has to go, and how much of
   *  the clip's rotation has been handed to the root so far. */
  let step: {
    sign: number;
    total: number;
    done: number;
    last: number;
    elapsed: number;
    base: THREE.Quaternion | null;
    /** The turn is over but its clip is still fading out. See applyRootMotion. */
    settling: number;
    /** Where his heading was when the turn started, so the step lands exactly
     *  where the clip said and not on a guess. */
    startYaw: number;
  } | null = null;

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
    // Not dropped outright: if he is interrupted mid-pivot — which is exactly
    // what happens when somebody talks to him — the turn clip is still fading
    // out, and letting go of the hips right then pops whatever is left of it
    // onto him. Hand them back the same way a finished turn does.
    if (step) { step.settling = Math.max(step.settling, SETTLE_SECONDS); step.total = step.done; }
    wait = rand(config.pauseMin, config.pauseMax);
    colin.play(pickIdle());
  };

  /* Scratch, reused every frame: this runs inside the render loop and a fresh
     quaternion per frame is a fresh allocation per frame. */
  const _parent = new THREE.Quaternion();
  const _up = new THREE.Vector3();
  const _rel = new THREE.Quaternion();
  const _inv = new THREE.Quaternion();
  const _axis = new THREE.Vector3();
  const _twist = new THREE.Quaternion();
  const _cancel = new THREE.Quaternion();
  const _tmp = new THREE.Quaternion();
  /** The last dt `update` saw, so the settle runs on seconds and not on frames. */
  let lastDt = 1 / 60;

  /**
   * Take the rotation the turn clip baked into the hips and put it on the root
   * instead. Same picture on screen, except that now he has actually turned:
   * the root keeps it when the clip loops or ends, so there is no snap back.
   *
   * The clip's own curve drives it — 0, 15, 40, 84, 103 degrees across the
   * clip, which is a foot planting and a body swinging round it, not a constant
   * rate. Rotating the root at some fixed speed of our own instead would slide
   * his feet across the floor for the whole turn.
   *
   * Only the twist about world up is moved. The rest of what the hips do — the
   * lean into the pivot — is the animation and stays on the bone. And the axis
   * is world up mapped INTO the hips' parent frame rather than assumed to be
   * local Y: this armature hangs under a node rotated -90° about X, so local Y
   * there is not up at all.
   */
  const applyRootMotion = () => {
    const bone = hips;
    if (!step || !bone || !bone.parent) return;
    if (!step.base) { step.base = bone.quaternion.clone(); return; }

    bone.parent.updateWorldMatrix(true, false);
    bone.parent.getWorldQuaternion(_parent);
    _up.set(0, 1, 0).applyQuaternion(_inv.copy(_parent).invert()).normalize();

    _rel.copy(bone.quaternion).multiply(_inv.copy(step.base).invert());
    _axis.set(_rel.x, _rel.y, _rel.z);
    const along = _axis.dot(_up);
    _twist.set(_up.x * along, _up.y * along, _up.z * along, _rel.w);
    if (_twist.lengthSq() < 1e-12) return;
    _twist.normalize();

    // Signed angle of the twist: its vector part projected back onto the axis is
    // sin(angle/2), its w is cos(angle/2).
    const sin = _axis.set(_twist.x, _twist.y, _twist.z).dot(_up);
    let angle = 2 * Math.atan2(sin, _twist.w);
    // Into (-pi, pi], so a clip that runs past half a turn does not read as
    // going backwards.
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;

    let delta = angle - step.last;
    // A guard only: the clip is capped below so it never loops, and a jump this
    // size could only be one starting over.
    if (Math.abs(delta) > Math.PI / 3) delta = 0;
    step.last = angle;

    /* Magnitude from the clip, DIRECTION from where he is going. The clip is
       already the right-handed one for this turn, so the two agree — but taking
       the direction from the target means a clip with an unexpected sign turns
       him toward his destination anyway, rather than away from it forever. */
    /* Settling: the turn is finished and the root has all of it, but the clip
       is still on its way out of the cross-fade and still pushing the hips
       round. Stop cancelling the moment the turn ends and every degree left in
       that fade snaps back onto him — measured at 76 degrees in one frame on a
       180. So keep cancelling, and transfer nothing, until the fade is done. */
    if (step.settling > 0) {
      step.settling -= lastDt;
      /* Released gradually, not dropped. Cancelling in full right up to the last
         frame and then stopping pops whatever the walk's own hip swing happens
         to be at that instant — 25 degrees, measured. Easing the cancellation
         out hands the hips back to the animation without a seam. */
      const k = Math.max(0, Math.min(1, step.settling / SETTLE_SECONDS));
      _cancel.identity().slerp(_tmp.copy(_twist).invert(), k);
      bone.quaternion.premultiply(_cancel);
      if (step.settling <= 0) step = null;
      return;
    }

    let use = Math.abs(delta);
    if (step.done + use >= step.total) {
      step.done = step.total;
      // Where the clip actually got to, NOT the target: on a big turn the step
      // is only part of the way round and the walk steers out the rest.
      colin.root.rotation.y = step.startYaw + step.sign * step.total;
      step.settling = SETTLE_SECONDS;
      phase = 'walking';
      if (walk) colin.play(walk, 0.25);
    } else {
      step.done += use;
      colin.root.rotation.y += step.sign * use;
    }

    // Undo it on the bone, or he turns twice: once here and once from the clip.
    bone.quaternion.premultiply(_tmp.copy(_twist).invert());

  };

  const update = (dt: number) => {
    lastDt = dt;
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
      const change = angleDelta(colin.root.rotation.y, yaw);
      const clip = change > 0 ? turnLeft : turnRight;
      if (canStepTurn && clip && Math.abs(change) >= THREE.MathUtils.degToRad(STEP_TURN_MIN_DEG)) {
        step = {
          sign: Math.sign(change),
          total: Math.min(Math.abs(change), THREE.MathUtils.degToRad(MAX_STEP_TURN_DEG)),
          done: 0, last: 0, elapsed: 0, base: null, settling: 0,
          startYaw: colin.root.rotation.y,
        };
        colin.play(clip, 0.2);
        phase = 'turning';
      } else if (Math.abs(change) >= THREE.MathUtils.degToRad(STEP_TURN_MIN_DEG)) {
        phase = 'turning';                 // no clips: the old rotate-in-place
      } else {
        // Small correction. He walks the corner instead, which the walking phase
        // already steers for.
        phase = 'walking';
        if (walk) colin.play(walk, 0.25);
      }
      return;
    }

    const turn = angleDelta(colin.root.rotation.y, facing);
    if (phase === 'turning') {
      if (step) {
        // applyRootMotion is driving this, after the mixer. Nothing to do here
        // but watch the clock: a clip that never delivers its rotation would
        // otherwise leave him turning for ever.
        step.elapsed += dt;
        if (step.elapsed < STEP_TURN_TIMEOUT) return;
        step = null;
      }
      const remaining = THREE.MathUtils.degToRad(config.turnSpeed) * dt;
      if (Math.abs(turn) <= remaining) {
        colin.root.rotation.y = facing;
        phase = 'walking';
        if (walk) colin.play(walk, 0.25);
      } else {
        colin.root.rotation.y += Math.sign(turn) * remaining;
        // No clip for it, so keep the feet moving rather than sliding a statue
        // round. Only small turns land here by design.
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
  return { update, applyRootMotion, config, halt, get phase() { return phase; }, get target() { return target; } };
}
