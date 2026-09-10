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
  /** Degrees the camera turns toward whatever it is following. */
  followDeg: number;
  /** Seconds to catch up. Long: the camera should lag him, not track him. */
  followLag: number;
  /** Degrees of mouse-follow sway. Desktop only — see the note on touch below. */
  swayDeg: number;
}

export const DEFAULT_RIG: RigConfig = { followDeg: 2.6, followLag: 1.1, swayDeg: 2.5 };

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
      wanted.set(
        THREE.MathUtils.clamp(localTarget.x / distance / 0.45, -1, 1),
        THREE.MathUtils.clamp(localTarget.y / distance / 0.45, -1, 1),
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
    euler.set(
      follow.y * f * 0.6 - sway.y * s * 0.5,
      follow.x * f - sway.x * s,
      0,
      'YXZ',
    );
    camera.quaternion.copy(base).multiply(q.setFromEuler(euler));
  };

  return { update, config, setTarget: (t) => { target = t; } };
}
