// Framing him deliberately, instead of following him around a room.
//
// The camera rig is an operator: it sits where Blender put it and pans to keep
// him in shot. That is right for the kitchen and useless for a screen whose
// whole job is looking at a jacket — so this takes the camera off the rig and
// puts it on a mark, at a chosen distance, on a chosen lens.
//
// THE DISTANCE IS DERIVED, NOT DIALLED IN. A shot says how many metres of world
// it wants to see from top to bottom; how far back that is depends on the lens
// and on the viewport, which on a phone in portrait is a very different shape
// from a laptop. Solving for it every time is what makes one set of numbers
// frame him the same on both.
//
//   d = coverM / (2 · tan(fov / 2))
//
// The lens is set through the kitchen's own framing so there is one code path
// for it, and put back when the camera is handed to the rig again.
import * as THREE from 'three';
import { fovForLens, type Framing } from './kitchenEnvironment';

export interface Shot {
  /** Focal length in mm, 35mm-equivalent — the same scale as `fovForLens`. */
  lensMm: number;
  /** Metres of world height the frame should cover. His fitted height is 2.1. */
  coverM: number;
  /** Height above his feet the camera points at, in metres. */
  lookAtY: number;
  /** Height above his feet the camera sits at. Eye level is about 1.9. */
  eyeY: number;
  /** Degrees around him from straight-on. He faces +z, so 0 is face-first. */
  yawDeg: number;
}

/**
 * How much of the top and bottom of the screen the interface is sitting on, as
 * fractions of its height.
 *
 * Every shot is framed inside what is LEFT, not inside the viewport. The trays
 * on these screens are three rows deep in places, and a shot centred on the
 * window puts his shoes behind a row of buttons — so the interface measures
 * itself after every layout and the camera backs off and tilts down by exactly
 * that much. It is the difference between guessing a margin per screen and
 * never having to think about it again.
 */
export interface SafeArea { top: number; bottom: number }

/* A short lens on a person is a caricature — it is why phone selfies have big
   noses — so everything here is 40mm and up, and the long end is reserved for
   the shots that are actually about his face. */
export const SHOTS = {
  /** Him in a room, with air around him. What the app opens on, and the only
   *  shot that is about the SPACE as much as the figure: a white sweep with a
   *  figure filling it is a passport photo. */
  standing: { lensMm: 45, coverM: 3.05, lookAtY: 1.04, eyeY: 1.32, yawDeg: 0 },
  /** Head to toe, a little air top and bottom. The outfit shot. */
  full: { lensMm: 42, coverM: 2.45, lookAtY: 1.06, eyeY: 1.2, yawDeg: 0 },
  /** Knees up. Close enough to read a face, wide enough to see a pose. */
  half: { lensMm: 50, coverM: 1.62, lookAtY: 1.34, eyeY: 1.44, yawDeg: 0 },
  /** Head and shoulders, on a proper portrait lens. */
  portrait: { lensMm: 72, coverM: 0.92, lookAtY: 1.76, eyeY: 1.8, yawDeg: 0 },
  /** Three-quarter, further out — room to see a scene behind him. */
  wide: { lensMm: 40, coverM: 3.1, lookAtY: 1.0, eyeY: 1.35, yawDeg: -22 },
} satisfies Record<string, Shot>;

export type ShotName = keyof typeof SHOTS;

export interface ShotDirector {
  /** Frame this, or null to hand the camera back to the rig. */
  set: (shot: ShotName | Shot | null, immediate?: boolean) => void;
  /** True while the director owns the camera — the rig must stand down. */
  readonly active: boolean;
  readonly shot: Shot | null;
  /**
   * Who is being framed, and what counts as the ground under them.
   *
   * `target` should be something in the middle of the body rather than the root:
   * a clip that lunges toward the camera moves his hips a metre and leaves the
   * root where it was, and a camera locked to the root turns that into a face
   * filling the screen. `floor` supplies the height the shot measures from, so
   * the frame does not ride up and down with his hips as he walks.
   */
  aim: (target: THREE.Object3D | null, floor?: THREE.Object3D | null) => void;
  /** Turntable, in degrees from the shot's own yaw. Dragging sets this. */
  orbit: number;
  /** Pull back or push in, as a multiple of the solved distance. */
  zoom: number;
  /** What the interface is covering. Set it after every layout. */
  safe: SafeArea;
  /** Call every frame, before rendering. Returns true if it moved the camera. */
  update: (dt: number) => boolean;
  /** Re-solve after a resize: the viewport decides the field of view. */
  refit: () => void;
  /** Drag to turn around him, wheel to push in. */
  enableDrag: (element: HTMLElement) => () => void;
}

/** How fast the camera arrives, in seconds to close most of the gap. */
const EASE = 0.34;
/** How slowly the thing being framed is allowed to move. Long, deliberately: a
 *  walk cycle swings the hips every step, and a camera that answers each one is
 *  seasick. This follows where he has GOT to, not what he is doing. */
const ANCHOR_LAG = 0.7;

export function createShotDirector(
  camera: THREE.PerspectiveCamera,
  framing: Framing,
  resize: () => void,
): ShotDirector {
  /** The room's own lens, restored the moment the rig gets the camera back. */
  const roomFov = framing.referenceFov;

  let shot: Shot | null = null;
  let target: THREE.Object3D | null = null;
  let floor: THREE.Object3D | null = null;
  let orbit = 0;
  let zoom = 1;
  const safe: SafeArea = { top: 0, bottom: 0 };
  /** Skip the ease for the first frame of a shot, so switching screens does not
   *  fly the camera across the room in front of you. */
  let snap = false;

  const wanted = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const foot = new THREE.Vector3();
  /** Where the shot thinks he is: the damped version of the two above. */
  const anchor = new THREE.Vector3();
  let anchored = false;
  const measured = new THREE.Vector3();
  const ground = new THREE.Vector3();
  const look = new THREE.Matrix4();
  const wantedQ = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  const applyLens = () => {
    if (!shot) return;
    framing.referenceFov = fovForLens(shot.lensMm);
    resize();
  };

  const set = (next: ShotName | Shot | null, immediate = false) => {
    const resolved = typeof next === 'string' ? SHOTS[next] : next;
    if (resolved === shot) return;
    shot = resolved;
    snap = immediate;
    if (!shot) { framing.referenceFov = roomFov; resize(); return; }
    orbit = 0;
    zoom = 1;
    applyLens();
  };

  const update = (dt: number) => {
    if (!shot || !target) return false;

    target.getWorldPosition(measured);
    (floor ?? target).getWorldPosition(ground);
    measured.y = ground.y;
    if (!anchored || snap) { anchor.copy(measured); anchored = true; }
    else anchor.lerp(measured, 1 - Math.exp(-dt / ANCHOR_LAG));
    foot.copy(anchor);

    /* Solved from the ACTUAL field of view, which is not the lens on a narrow
       screen in `cover` mode — the framing opens the lens up to hold the
       horizontal, and a distance derived from the nominal one would cut his
       head off in portrait. */
    const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    /* Frame him inside the part of the screen the interface is not sitting on:
       open the shot up by however much is covered, then aim down by half the
       difference between the two edges so he lands in the middle of what is
       actually visible. Clamped, because a screen that is nearly all chrome
       would otherwise send the camera to the far wall. */
    const visible = Math.max(0.45, 1 - safe.top - safe.bottom);
    const covers = (shot.coverM * zoom) / visible;
    const distance = covers / (2 * Math.tan(halfFov));
    focus.copy(foot).setY(foot.y + shot.lookAtY - covers * (safe.bottom - safe.top) / 2);

    const yaw = THREE.MathUtils.degToRad(shot.yawDeg + orbit);
    wanted.set(
      foot.x + Math.sin(yaw) * distance,
      foot.y + shot.eyeY,
      foot.z + Math.cos(yaw) * distance,
    );

    look.lookAt(wanted, focus, up);
    wantedQ.setFromRotationMatrix(look);

    if (snap) {
      snap = false;
      camera.position.copy(wanted);
      camera.quaternion.copy(wantedQ);
    } else {
      const k = 1 - Math.exp(-dt / EASE);
      camera.position.lerp(wanted, k);
      camera.quaternion.slerp(wantedQ, k);
    }
    return true;
  };

  const enableDrag = (element: HTMLElement) => {
    let dragging = -1;
    let lastX = 0;
    const down = (e: PointerEvent) => {
      if (!shot || dragging >= 0) return;
      dragging = e.pointerId;
      lastX = e.clientX;
      element.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== dragging || !shot) return;
      // A third of a degree per pixel: a comfortable thumb-swipe is most of a
      // half turn, and nothing about the gesture feels like it is sliding.
      orbit += (e.clientX - lastX) * 0.34;
      lastX = e.clientX;
    };
    const up_ = (e: PointerEvent) => {
      if (e.pointerId !== dragging) return;
      dragging = -1;
      try { element.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    };
    const wheel = (e: WheelEvent) => {
      if (!shot) return;
      e.preventDefault();
      zoom = THREE.MathUtils.clamp(zoom * (1 + e.deltaY * 0.0012), 0.55, 2.2);
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up_);
    element.addEventListener('pointercancel', up_);
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up_);
      element.removeEventListener('pointercancel', up_);
      element.removeEventListener('wheel', wheel);
    };
  };

  return {
    set,
    get active() { return shot !== null; },
    get shot() { return shot; },
    aim: (t, f = null) => { target = t; floor = f; anchored = false; },
    get orbit() { return orbit; },
    set orbit(v: number) { orbit = v; },
    get zoom() { return zoom; },
    set zoom(v: number) { zoom = v; },
    safe,
    update,
    refit: applyLens,
    enableDrag,
  };
}
