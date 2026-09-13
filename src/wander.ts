// Colin walking around the kitchen on his own.
//
// The walk clips carry no net root motion — measured, `walk_fwd_normal` drifts
// 0.0 units over its length — so they are in-place cycles and the position is
// ours to drive. That is the easy case: no root-motion extraction, and the
// walk speed is a number we pick rather than one baked into the clip.
import * as THREE from 'three';
import type { Character } from './character';
import { IDLE_FOR, type Mood } from './mood';

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
  /**
   * Metres per second.
   *
   * Nothing in the clip ties the stride to the ground — the walks are in-place
   * cycles — so this used to be free to pick, and picking it wrong is what made
   * him skate. It is now the input to the clip's playback rate instead: see
   * WALK_CLIP_SPEED. Any value here is slide-free; it only decides whether he
   * ambles or marches.
   */
  speed: number;
  /** Degrees per second while turning on the spot. */
  turnSpeed: number;
  /** How long he stands around between anything, in seconds. */
  pauseMin: number;
  pauseMax: number;
  /**
   * Chance a pause simply ends in another pause, on a different idle.
   *
   * Without this every pause ended in a walk, and walk-pause-walk-pause is the
   * one rhythm a person never has. Standing still, shifting, and standing still
   * again is most of what somebody in a kitchen actually does.
   */
  restChance: number;
  /** Chance he turns on the spot and stays put, rather than walking off. */
  turnChance: number;
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
   * Every bound is his SHOULDERS, not his centre: the floor is sampled at nine
   * points around a 0.3 m radius rather than once under his origin, which is
   * what stops him walking an arm through a cabinet, and what keeps the far edge
   * off the stove at z 1.2.
   *
   * Re-solved after the room was re-exported with the dining set gone and the
   * stool and side table moved. The left opened up — the chairs had been in it —
   * and the right closed down, because the side table landed at about x 0.75,
   * z 1.8. The clear span is -2.15 to 0.40 and holds all the way to z 3.4, so
   * the floor is not what limits how near the camera he comes: FRAMING is.
   *
   * The near edge was 2.5 for as long as desktop sat at Blender's own 24 mm with
   * no dolly: his feet left the bottom of a landscape frame just past 2.6, and
   * that capped BOTH tiers. Desktop now carries the same 25 mm and 2.6 m back,
   * and in `lens` mode the vertical field of view does not change with aspect —
   * so the two tiers frame him identically down the middle and a wider screen is
   * strictly easier. Measured, both hold him whole past z 3.6.
   *
   * So 3.2, which is two metres of depth against 1.3, and takes him from 5.5 m
   * off the lens to 4.3 m at his nearest. The clear floor runs out at 3.4, so it
   * is the room that caps this now rather than the shot. */
  area: { minX: -2.1, maxX: 0.35, minZ: 1.2, maxZ: 3.2 },
  speed: 1.15,
  turnSpeed: 120,
  // He was standing 12-13 seconds between two-second walks, which on a phone
  // means you almost always catch him standing still and conclude he is idle.
  // Standing is still his default, but 93% of the time was too much of it: he
  // read as parked. Shorter pauses and a better-than-even chance of going
  // somewhere afterwards.
  pauseMin: 3,
  pauseMax: 8,
  restChance: 0.34,
  turnChance: 0.18,
  maxFacingAwayDeg: 115,
};

type Phase = 'idle' | 'turning' | 'walking';

export interface Wander {
  update: (dt: number) => void;
  /**
   * What the last exchange left him in. Biases which idle he falls into, and
   * nothing more — he still stands, turns and walks the same way. Set by the
   * conversation; `neutral` is the whole range.
   */
  moodIdle: Mood;
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

/**
 * How fast the walk clip is actually striding, in metres per second, at the
 * scale Colin is fitted to on load.
 *
 * Measured the way that actually answers the question: sweep the playback rate
 * and watch how fast the planted foot slides across the FLOOR. Sampling the
 * foot's velocity relative to the root looks like the obvious estimate and reads
 * low, because during double support the lower-foot test picks the swinging one
 * and drags the average down.
 *
 * Re-measured for `walk_fwd_neutral` on the new single-GLB Colin: the slide
 * bottoms out at a playback rate of 0.74 for a body moving at 1.15 m/s, so the
 * clip strides at 1.55. (The old model's walk wanted 1.77 — a different rig and
 * a different clip, so the number does not carry over, and re-exports are
 * exactly when this needs re-running.)
 *
 * Stride scales with him, so this is rescaled if his height is touched.
 */
const WALK_CLIP_SPEED = 1.55;

export function createWander(
  colin: Character,
  config: WanderConfig = { ...DEFAULT_WANDER, area: { ...DEFAULT_WANDER.area } },
): Wander {
  /* Names moved with the new export: walk_fwd_normal is walk_fwd_neutral,
     idle_turn_* are turn_*, and there is a Neutral_Idle alongside idle_neutral.
     Matched loosely rather than listed, so the next re-export does not silently
     leave him standing still. Kneeling and the dances are deliberately out: one
     is a pose he cannot stand up from and the others are not idling. */
  /* Anything idle-shaped, minus the ones that are a pose rather than a stand:
     kneeling has no way back up, and the moods are for the conversation to pick
     rather than for him to fall into on his own. */
  const idles = colin.clips.filter((c) => /idle/i.test(c) && !/kneel|sit|lay|sleep/i.test(c));
  const walk = colin.clips.find((c) => /^walk_fwd_neutral$/i.test(c))
    ?? colin.clips.find((c) => /^walk/i.test(c));
  /* He has proper turn-in-place clips and nothing was using them: a 180° change
     of heading played walk_fwd_normal while the root span, so he moonwalked
     round on the spot. They carry their rotation baked into the HIPS — 102.6°
     over 0.97s, measured — rather than in the root, which is why they cannot
     just be played: the clip would turn him and so would the root, twice over,
     and then snap back when the clip looped. See applyRootMotion. */
  const turnLeft = colin.clips.find((c) => /(^|_)turn_left$/i.test(c));
  const turnRight = colin.clips.find((c) => /(^|_)turn_right$/i.test(c));

  let hips: THREE.Bone | null = null;
  colin.model.traverse((o) => {
    const bone = o as THREE.Bone;
    if (!hips && bone.isBone && /hips/i.test(bone.name)) hips = bone;
  });
  const canStepTurn = !!(hips && turnLeft && turnRight);

  /** The fit at load, so a later height change rescales the stride with him. */
  const fitAtLoad = colin.model.scale.y || 1;
  let appliedSpeed = Number.NaN;
  const matchStrideToSpeed = () => {
    if (!walk || config.speed === appliedSpeed) return;
    appliedSpeed = config.speed;
    const natural = WALK_CLIP_SPEED * ((colin.model.scale.y || 1) / fitAtLoad);
    // Below 1 he ambles, above 1 he hurries; either way his feet stay put on the
    // ground, which is the only thing this is for.
    colin.setTimeScale(walk, natural > 1e-6 ? config.speed / natural : 1);
  };

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
    /** The twist as it stood the moment the turn finished, and the clip that
     *  put it there — both frozen, because what has to be undone from here is
     *  the TURN's contribution and not whatever the hips are doing now. */
    settleTwist: THREE.Quaternion | null;
    settleClip: string;
    /** Where his heading was when the turn started, so the step lands exactly
     *  where the clip said and not on a guess. */
    startYaw: number;
    /** Which turn clip is playing. */
    clip: string;
  } | null = null;

  /* Never the same idle twice running. With only a couple in the file that is
     barely a change; with a dozen it is most of what makes standing watchable,
     which is why the filter is a pattern rather than a list. */
  /* Idles that read as a mood are held back from the neutral pool. Otherwise he
     falls into the sad one at random and the mood layer means nothing — being
     visibly dejected has to be something the conversation did to him, not
     something that happens every fourth pause. */
  const flavoured = Object.entries(IDLE_FOR)
    .filter(([mood]) => mood !== 'neutral')
    .flatMap(([, patterns]) => patterns);
  const plainIdles = idles.filter((c) => !flavoured.some((p) => p.test(c)));

  let lastIdle = '';
  let moodIdle: Mood = 'neutral';
  const pickIdle = () => {
    if (!idles.length) return colin.clips[0];
    /* A mood narrows the pool rather than naming a clip. If the export has no
       sad idle in it the mood costs nothing and he picks from the plain ones,
       which is better than him standing still because a name went missing. */
    let pool = plainIdles.length ? plainIdles : idles;
    for (const pattern of IDLE_FOR[moodIdle] ?? []) {
      const hit = idles.filter((c) => pattern.test(c));
      if (hit.length) { pool = hit; break; }
    }
    if (pool.length === 1) return (lastIdle = pool[0]);
    let next = lastIdle;
    for (let i = 0; i < 8 && next === lastIdle; i++) {
      next = pool[Math.floor(Math.random() * pool.length)];
    }
    lastIdle = next;
    return next;
  };
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

  /** True when the turn now starting is the first half of going somewhere. */
  let pendingWalk = true;

  /** Start turning to `facing`, with the step clip when the change earns one. */
  const beginTurn = (change: number) => {
    const clip = change > 0 ? turnLeft : turnRight;
    if (Math.abs(change) < THREE.MathUtils.degToRad(STEP_TURN_MIN_DEG)) {
      // Too small to plant a foot for. Walk the corner, or if he was only going
      // to turn, do not bother at all.
      if (!pendingWalk) { wait = rand(config.pauseMin, config.pauseMax); return; }
      phase = 'walking';
      if (walk) colin.play(walk, 0.25);
      return;
    }
    if (canStepTurn && clip) {
      // play() resets an action's time but not its rate, and the last turn left
      // this one frozen — see the completion below.
      colin.setTimeScale(clip, 1);
      step = {
        sign: Math.sign(change),
        total: Math.min(Math.abs(change), THREE.MathUtils.degToRad(MAX_STEP_TURN_DEG)),
        done: 0, last: 0, elapsed: 0, base: null, settling: 0,
        settleTwist: null, settleClip: '', clip,
        startYaw: colin.root.rotation.y,
      };
      colin.play(clip, 0.2);
    }
    phase = 'turning';
  };

  /** Where a finished turn goes: on to the walk, or back to standing. */
  const afterTurn = () => {
    if (pendingWalk) {
      phase = 'walking';
      if (walk) colin.play(walk, 0.25);
    } else {
      phase = 'idle';
      wait = rand(config.pauseMin, config.pauseMax);
      colin.play(pickIdle(), 0.4);
    }
  };

  const halt = () => {
    phase = 'idle';
    // Not dropped outright: if he is interrupted mid-pivot — which is exactly
    // what happens when somebody talks to him — the turn clip is still fading
    // out, and letting go of the hips right then pops whatever is left of it
    // onto him. Hand them back the same way a finished turn does.
    if (step) {
      step.settling = Math.max(step.settling, SETTLE_SECONDS);
      step.total = step.done;
      step.settleTwist ??= _twist.clone();
      step.settleClip ||= step.clip;
    }
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
    if (step.settling > 0 && step.settleTwist) {
      step.settling -= lastDt;
      /* THE CLIP'S OWN WEIGHT DECIDES THIS, not a timer.
       *
       * The turn is over and the root has all of it, but the clip is still
       * inside its cross-fade and still posing the hips in proportion to how
       * much of it is left. Two earlier attempts both twitched, for opposite
       * reasons: cancelling in full and then stopping dead pops whatever the
       * WALK's hip swing happens to be at that instant (25°, measured), and
       * easing the cancellation out on a timer re-exposes the TURN's residual
       * faster than the fade removes it — measured, he over-rotated 13° and
       * swung back 18° right at the seam, which is the twitch.
       *
       * A cross-fade poses the hips at roughly the turn's twist times its
       * weight, so cancelling exactly that tracks the fade instead of racing
       * it: full at weight 1, nothing at weight 0, continuous at both ends.
       * And it is the FROZEN twist, so the walk's own hip motion is left alone
       * rather than being cancelled along with it. */
      const k = Math.max(0, Math.min(1, colin.weightOf(step.settleClip)));
      _cancel.identity().slerp(_tmp.copy(step.settleTwist).invert(), k);
      bone.quaternion.premultiply(_cancel);
      // The timer is only a backstop, for a fade that never finishes.
      if (k < 0.02 || step.settling <= 0) {
        colin.setTimeScale(step.settleClip, 1);
        step = null;
      }
      return;
    }

    let use = Math.abs(delta);
    if (step.done + use >= step.total) {
      step.done = step.total;
      // Where the clip actually got to, NOT the target: on a big turn the step
      // is only part of the way round and the walk steers out the rest.
      colin.root.rotation.y = step.startYaw + step.sign * step.total;
      step.settling = SETTLE_SECONDS;
      step.settleTwist = _twist.clone();
      step.settleClip = step.clip;
      /* FREEZE THE CLIP, or the correction below is aiming at a moving target.
         A turn clip is 0.97s long and delivers 122°; a 95° step reaches its cap
         at about 0.95s — a hair before the clip loops. So through the fade-out
         its twist would snap from 122° back to zero while the correction was
         still undoing 95°, which is a 48° lurch, measured. Stopping its clock
         holds the pose it finished on, and the pose is then exactly what the
         weight below says it is. */
      colin.setTimeScale(step.clip, 0);
      afterTurn();
    } else {
      step.done += use;
      colin.root.rotation.y += step.sign * use;
    }

    // Undo it on the bone, or he turns twice: once here and once from the clip.
    bone.quaternion.premultiply(_tmp.copy(_twist).invert());

  };

  const update = (dt: number) => {
    lastDt = dt;
    matchStrideToSpeed();
    if (!config.enabled) return;

    if (phase === 'idle') {
      wait -= dt;
      if (wait > 0) return;

      /* What he does next, and mostly it is nothing. A different idle is still
         a change — the clips have their own weight shifts and glances in them —
         and it costs him no ground, which is the point. */
      const roll = Math.random();
      if (roll < config.restChance) {
        wait = rand(config.pauseMin, config.pauseMax);
        colin.play(pickIdle(), 0.6);
        return;
      }
      if (roll < config.restChance + config.turnChance) {
        // Turn to look at something else and stay where he is.
        const away = THREE.MathUtils.degToRad(rand(35, config.maxFacingAwayDeg * 0.8));
        const yaw = angleDelta(0, colin.root.rotation.y) > 0 ? -away : away;
        if (!withinFacingLimit(yaw)) return;
        facing = yaw;
        pendingWalk = false;
        beginTurn(angleDelta(colin.root.rotation.y, yaw));
        return;
      }

      const next = chooseTarget();
      if (!next) { wait = 1; return; }
      const yaw = faceOf(next);
      // Retry immediately rather than standing another half second: this was
      // adding several seconds to pauses that were already too long.
      if (!withinFacingLimit(yaw)) return;
      target.copy(next);
      facing = yaw;
      pendingWalk = true;
      beginTurn(angleDelta(colin.root.rotation.y, yaw));
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
        afterTurn();
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

  matchStrideToSpeed();
  colin.play(pickIdle(), 0);
  return {
    update, applyRootMotion, config, halt,
    get moodIdle() { return moodIdle; },
    set moodIdle(v: Mood) { moodIdle = v; },
    get phase() { return phase; },
    get target() { return target; },
  };
}
