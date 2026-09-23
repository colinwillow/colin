// Driving him by hand, instead of letting the wander decide.
//
// There are no pose assets. There are nineteen clips, and a pose is a place
// inside one of them — pick a clip, stop its clock, and whatever frame it landed
// on is a pose you can save, name and come back to. That is the whole trick, and
// it means every new animation exported from Cinema 4D arrives carrying a few
// hundred poses with it.
//
// The wander and this cannot both be steering. Taking a pose switches the
// wander off; `release` hands him back.
import type { Character } from './character';

export interface Pose {
  /** The clip it lives in. */
  clip: string;
  /** What to call it on screen. */
  name: string;
}

export interface PoseGroup {
  id: string;
  name: string;
  poses: Pose[];
}

export interface SavedPose {
  id: string;
  name: string;
  clip: string;
  /** Seconds into the clip. */
  time: number;
}

export interface Poses {
  groups: PoseGroup[];
  /** Start a clip running and stop the wander steering him. */
  play: (clip: string) => void;
  /**
   * Run a clip because he was asked to, and hand him back when it is over.
   *
   * The only difference from `play` is the clock. `play` is somebody holding
   * the controls, and it holds them until they let go; this is him doing a
   * thing and then going back to being himself, which is what a spoken order
   * means. `seconds` left out is the clip's own length — right for a wave,
   * which is over when the hand comes down, and wrong for a dance, which is a
   * loop somebody has to decide to stop.
   *
   * False for a clip the export does not carry, which is how an order for a
   * move he has not got knows to say something instead of doing nothing.
   */
  perform: (clip: string, seconds?: number) => boolean;
  /** Counts a performance down. Call from the render loop. */
  update: (dt: number) => void;
  /** True while this is steering him rather than the wander. Anything asking
   *  "may he walk" has to include it, or the end of a sentence hands the floor
   *  back to the wander in the middle of a dance. */
  readonly driving: boolean;
  /** Freeze the clip where it is, or let it run again. */
  hold: (on: boolean) => void;
  readonly holding: boolean;
  readonly clip: string | null;
  /** Nudge a held pose along its own clip, in seconds. */
  scrub: (seconds: number) => void;
  /** Where the held clip is, 0–1, for a scrubber. */
  progress: () => number;
  /** Hand him back to the wander. */
  release: () => void;
  saved: SavedPose[];
  /** Keep the frame he is on right now. */
  save: (name?: string) => SavedPose | null;
  restore: (id: string) => void;
  remove: (id: string) => void;
}

/** The container track Cinema 4D writes out. Never a pose. */
const HIDDEN = /^CINEMA_4D/i;

const GROUPS: { id: string; name: string; match: RegExp }[] = [
  { id: 'idle', name: 'Standing', match: /^(idle|neutral)/i },
  { id: 'dance', name: 'Dancing', match: /^dance/i },
  { id: 'move', name: 'Moving', match: /^(walk|run|turn)/i },
  { id: 'act', name: 'Doing', match: /.*/ },
];

/** `dance_hiphop_01` → `Hip-hop 1`. Clip names are for the file; this is for a
 *  button, and a button that says `idle_sad_kick` is a debug build. */
export function poseName(clip: string): string {
  return clip
    .replace(/^(idle|dance|walk|run|turn)_/i, '')
    .replace(/_fwd\b/gi, ' forward')
    .replace(/hiphop/gi, 'hip-hop')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\b0*(\d+)\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}

const KEY = 'colin.poses.v1';

export function createPoses(
  colin: Character,
  wander: { config: { enabled: boolean }; halt: () => void },
  /** Whether the scene he is in has a floor to walk on. Asked at the moment he
   *  is handed back, because the room may have changed while he was posing. */
  canWander: () => boolean = () => true,
): Poses {
  const groups: PoseGroup[] = GROUPS.map((g) => ({ id: g.id, name: g.name, poses: [] }));
  for (const clip of colin.clips) {
    if (HIDDEN.test(clip)) continue;
    const g = GROUPS.find((x) => x.match.test(clip))!;
    groups.find((x) => x.id === g.id)!.poses.push({ clip, name: poseName(clip) });
  }

  let clip: string | null = null;
  let holding = false;
  /** Seconds left on a performance, or 0 when nobody is counting. */
  let left = 0;

  const saved: SavedPose[] = (() => {
    try {
      const list = JSON.parse(localStorage.getItem(KEY) || '[]') as SavedPose[];
      // A pose whose clip is no longer in the export is not a pose any more.
      return list.filter((p) => p && colin.clips.includes(p.clip));
    } catch { return []; }
  })();

  const store = () => {
    try { localStorage.setItem(KEY, JSON.stringify(saved)); }
    catch { /* private mode: they last until the tab closes */ }
  };

  const play = (next: string) => {
    if (!colin.clips.includes(next)) return;
    // Whatever was being counted down is not what is playing any more.
    left = 0;
    wander.halt();
    wander.config.enabled = false;
    // A clip that was frozen last time it was used still has timeScale 0 on it.
    colin.setTimeScale(next, 1);
    colin.play(next, 0.35);
    clip = next;
    holding = false;
  };

  const hold = (on: boolean) => {
    if (!clip) return;
    // Freezing a performance is a decision to keep it, so stop counting.
    if (on) left = 0;
    holding = on;
    colin.setTimeScale(clip, on ? 0 : 1);
  };

  const release = () => {
    left = 0;
    if (clip) colin.setTimeScale(clip, 1);
    /* Cleared BEFORE the wander is asked, because what it is asked is whether
       he may walk, and the answer now includes whether this is still driving
       him. */
    clip = null;
    holding = false;
    wander.config.enabled = canWander();
    // Back to an idle now rather than whenever the wander's own pause happens
    // to run out: a dance that keeps going for four seconds after it was
    // released reads as the release not having worked.
    wander.halt();
  };

  const perform = (next: string, seconds?: number) => {
    if (!colin.clips.includes(next)) return false;
    play(next);
    const at = colin.timeOf(next);
    left = Math.max(0.5, seconds ?? at?.duration ?? 3);
    return true;
  };

  const update = (dt: number) => {
    if (left <= 0) return;
    left -= dt;
    if (left <= 0) release();
  };

  return {
    groups: groups.filter((g) => g.poses.length),
    play,
    perform,
    update,
    get driving() { return clip !== null; },
    hold,
    get holding() { return holding; },
    get clip() { return clip; },
    scrub: (seconds) => {
      if (!clip) return;
      colin.seek(clip, seconds);
    },
    progress: () => {
      if (!clip) return 0;
      const at = colin.timeOf(clip);
      return at && at.duration ? at.time / at.duration : 0;
    },
    release,
    saved,
    save: (name) => {
      if (!clip) return null;
      const at = colin.timeOf(clip);
      if (!at) return null;
      const pose: SavedPose = {
        id: `p${Date.now().toString(36)}`,
        name: name || poseName(clip),
        clip,
        time: at.time,
      };
      saved.unshift(pose);
      // Enough to be a collection, not so many that the row becomes a filing
      // cabinet. The oldest falls off the end.
      if (saved.length > 24) saved.length = 24;
      store();
      return pose;
    },
    restore: (id) => {
      const pose = saved.find((p) => p.id === id);
      if (!pose) return;
      play(pose.clip);
      colin.seek(pose.clip, pose.time);
      hold(true);
    },
    remove: (id) => {
      const i = saved.findIndex((p) => p.id === id);
      if (i >= 0) { saved.splice(i, 1); store(); }
    },
  };
}
