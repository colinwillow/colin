// Which asset set to load.
//
// The desktop set needs roughly 1.4 GB of GPU memory once decoded — 4K colour
// textures and 4K lightmaps — which blanks or kills phone browsers. The mobile
// set is the same room at 2K colour, 1K normal/roughness and a half-size probe,
// around 380 MB. See MOBILE.md.

export type Quality = 'desktop' | 'mobile';

export interface QualityChoice {
  quality: Quality;
  /** Why this was chosen, for the console line. */
  reason: string;
}

/**
 * Pick an asset set, with `?quality=mobile` / `?quality=desktop` overriding so
 * the mobile set can be checked on a desktop.
 *
 * A coarse pointer is the main signal. iPadOS is the awkward case: it reports
 * itself as a Mac in the user agent, so the platform string cannot be trusted —
 * but it does expose touch points, and a Mac never has more than one. Touch
 * points alone are not enough, since a touchscreen laptop has them too and is
 * perfectly capable of the desktop set; there the pointer stays fine.
 */
export function pickQuality(): QualityChoice {
  const override = new URLSearchParams(location.search).get('quality');
  if (override === 'mobile' || override === 'desktop') {
    return { quality: override, reason: '?quality= override' };
  }

  if (matchMedia('(pointer: coarse)').matches) {
    return { quality: 'mobile', reason: 'coarse pointer' };
  }

  const macLike = /Mac/.test(navigator.platform ?? '') || /Macintosh/.test(navigator.userAgent);
  if (macLike && navigator.maxTouchPoints > 1) {
    return { quality: 'mobile', reason: 'iPadOS (reports as a Mac, but has touch points)' };
  }

  return { quality: 'desktop', reason: 'fine pointer' };
}

export interface QualitySettings {
  manifest: string;
  /** Cap on devicePixelRatio. Phones are dense enough that 1.5 is plenty. */
  maxPixelRatio: number;
  /** Anisotropic filtering cap. 16 on a phone costs bandwidth for little gain. */
  maxAnisotropy: number;
  /**
   * Mouse-follow sway. `pointermove` only fires on a touch screen while a finger
   * is down, so on a phone the camera would lurch on tap rather than breathe.
   */
  sway: boolean;
}

export const QUALITY: Record<Quality, QualitySettings> = {
  desktop: {
    manifest: 'kitchen_lightmaps.json',
    maxPixelRatio: 2,
    maxAnisotropy: Infinity,
    sway: true,
  },
  mobile: {
    manifest: 'kitchen_lightmaps_mobile.json',
    maxPixelRatio: 1.5,
    maxAnisotropy: 4,
    sway: false,
  },
};
