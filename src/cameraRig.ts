// What the camera does while Colin moves around.
//
// Replaces the tilt-and-drag experiment: device orientation needs a permission
// prompt on iOS, and stacking one on top of the microphone prompt to get a
// couple of degrees of parallax is a bad trade. Following him costs nothing and
// asks for nothing.
//
// Everything composes onto the camera's baked orientation rather than replacing
// it, so the Blender framing stays the anchor and each contribution is a small
// offset from it.
import * as THREE from 'three';

export interface RigConfig {
  /** The most the camera will turn away from the baked framing, in degrees.
   *
   *  This is what decides how much room he gets. At the old 2.6° the shot barely
   *  moved, so he could only ever be where the Blender framing already pointed —
   *  a strip about as wide as the rug. Turning the camera properly is what makes
   *  the rest of the floor usable. */
  followDeg: number;
  /** How much of the angle to him the camera takes up. Below 1 so he still
   *  crosses the frame as he walks instead of being pinned to the middle, which
   *  reads as a tripod rather than a lock-on. */
  followGain: number;
  /** Seconds to catch up. Long: the camera should lag him, not track him. */
  followLag: number;
  /** Degrees of mouse-follow sway. Desktop only — see the note on touch below. */
  swayDeg: number;
}

export const DEFAULT_RIG: RigConfig =
  { followDeg: 18, followGain: 0.8, followLag: 1.1, swayDeg: 2.5 };

export interface CameraRig {
  update: (dt: number) => void;
  config: RigConfig;
  /** Follow this each frame, or null to stop. */
  setTarget: (target: THREE.Object3D | null) => void;
}

export function createCameraRig(
  camera: THREE.PerspectiveCamera,
  { mouse = true, config = { ...DEFAULT_RIG } }: { mouse?: boolean; config?: RigConfig } = {},
): CameraRig {
  const base = camera.quaternion.clone();
  const basePosition = camera.position.clone();

  let target: THREE.Object3D | null = null;
  const swayTarget = new THREE.Vector2();
  const sway = new THREE.Vector2();
  const follow = new THREE.Vector2();     // current, normalised -1..1
  const wanted = new THREE.Vector2();

  if (mouse) {
    // Only on a mouse: pointermove on a touch screen fires just while a finger
    // is down, which reads as a lurch on tap rather than as breathing.
    window.addEventListener('pointermove', (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      swayTarget.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        (e.clientY / window.innerHeight) * 2 - 1,
      );
    }, { passive: true });
  }

  const worldTarget = new THREE.Vector3();
  const localTarget = new THREE.Vector3();
  const euler = new THREE.Euler();
  const q = new THREE.Quaternion();
  const inverseBase = base.clone().invert();

  const update = (dt: number) => {
    if (target) {
      // Where he is relative to the camera's resting orientation, so "left of
      // frame" is left however the shot was framed.
      target.getWorldPosition(worldTarget);
      // Aim at his chest rather than his feet, or the camera dips as he nears.
      worldTarget.y += 1.1;
      localTarget.copy(worldTarget).sub(basePosition).applyQuaternion(inverseBase);
      const distance = Math.max(0.001, -localTarget.z);
      /* The REAL angle to him, in radians, rather than a fraction of an
         arbitrary 0.45 slope. That mattered once the camera was allowed to turn
         properly: a normalised -1..1 says "he is far to the left" identically
         whether that is 12° or 30°, so the camera undershot whenever he was
         genuinely out at the edge of the room — which is the only time it needed
         to do anything. */
      wanted.set(
        Math.atan2(localTarget.x, distance),
        Math.atan2(localTarget.y, distance),
      );
    } else {
      wanted.set(0, 0);
    }

    // Frame-rate independent smoothing, so a slow phone lags the same as a fast
    // desktop rather than crawling.
    const followK = 1 - Math.exp(-dt / Math.max(0.001, config.followLag));
    follow.lerp(wanted, followK);
    sway.lerp(swayTarget, 1 - Math.exp(-dt / 0.25));

    const f = THREE.MathUtils.degToRad(config.followDeg);
    const s = THREE.MathUtils.degToRad(config.swayDeg);
    // `follow` is now an angle, so the gain and the cap are the whole story:
    // take this much of the way toward him, and never more than this far off the
    // baked framing.
    const yaw = THREE.MathUtils.clamp(follow.x * config.followGain, -f, f);
    // Pitch stays a fraction of the yaw budget: the room is wide and short, and
    // a camera that tilts as much as it pans looks seasick.
    const pitch = THREE.MathUtils.clamp(follow.y * config.followGain, -f * 0.25, f * 0.25);
    /* The yaw is NEGATED, and that was the bug. A camera looks down -Z, so a
       positive rotation about Y swings its forward vector toward -X — it turns
       LEFT. He walks right, `follow.x` goes positive, and the camera turned away
       from him: every step he took toward the edge of frame, the shot pushed him
       further out, which is why he kept disappearing.
       Pitch is not negated, because a positive rotation about X does tilt the
       view up, which is the way you want it when he is high in frame. */
    euler.set(
      pitch - sway.y * s * 0.5,
      -yaw - sway.x * s,
      0,
      'YXZ',
    );
    camera.quaternion.copy(base).multiply(q.setFromEuler(euler));
  };

  return { update, config, setTarget: (t) => { target = t; } };
}
