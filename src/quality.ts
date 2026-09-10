// Which asset set to load.
//
// The desktop set needs roughly 1.4 GB of GPU memory once decoded — 4K colour
// textures and 4K lightmaps — which blanks or kills phone browsers. The mobile
// set is the same room at 2K colour, 1K normal/roughness and a half-size probe,
// around 380 MB. See MOBILE.md.

export type Quality = 'desktop' | 'mobile' | 'mobile-ktx2';

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
  if (override === 'mobile' || override === 'desktop' || override === 'mobile-ktx2') {
    return { quality: override, reason: '?quality= override' };
  }

  if (matchMedia('(pointer: coarse)').matches) {
    return { quality: 'mobile-ktx2', reason: 'coarse pointer' };
  }

  const macLike = /Mac/.test(navigator.platform ?? '') || /Macintosh/.test(navigator.userAgent);
  if (macLike && navigator.maxTouchPoints > 1) {
    return { quality: 'mobile-ktx2', reason: 'iPadOS (reports as a Mac, but has touch points)' };
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
   * Which sway to use. `mouse` follows the cursor; `touch` uses device tilt where
   * it is allowed and drag otherwise, because `pointermove` on a touch screen
   * only fires while a finger is down and would lurch on tap rather than breathe.
   */
  sway: 'mouse' | 'touch';
  /**
   * 35mm-equivalent focal length, or undefined to keep the GLB's own 24 mm.
   *
   * A tall screen at the reference 24 mm crops most of the kitchen away — the
   * window, fridge and shelves all fall outside the frame. Going a little wider
   * brings the room back without the distortion of letting the fit open the lens
   * up on its own, which reaches 7 mm and throws the near furniture at you.
   * 16 mm is about halfway between those two. Desktop keeps 24 mm, the shot as
   * framed in Blender.
   */
  lensMm?: number;
  /** Which character GLB to load. */
  characterGlb: string;
  /**
   * Skin to load over whatever the GLB carries, or undefined to use its own.
   * The KTX2 build has the lighter atlas baked in, so it overrides nothing —
   * which also spares a phone decoding the original just to throw it away.
   */
  characterSkin?: string;
}

export const QUALITY: Record<Quality, QualitySettings> = {
  desktop: {
    manifest: 'kitchen_lightmaps.json',
    maxPixelRatio: 2,
    maxAnisotropy: Infinity,
    sway: 'mouse',
    characterGlb: 'colin_stylized_01.glb',
    characterSkin: 'Mat_diffuse_lighter.webp',
  },
  /**
   * What phones actually get. Same room again with every texture as KTX2 —
   * ETC1S for colour, UASTC for normal, roughness and the lightmaps.
   *
   * It stays compressed on the GPU, which is the whole point: 95 MB against the
   * WebP set's 382 MB. GPU memory is the thing that blanks a phone browser, so
   * it is worth the download going 14.4 MB to 23.7 MB. `?quality=mobile` loads
   * the WebP set to compare.
   */
  'mobile-ktx2': {
    manifest: 'kitchen_lightmaps_mobile_ktx2.json',
    maxPixelRatio: 1.5,
    maxAnisotropy: 4,
    sway: 'touch',
    lensMm: 16,
    characterGlb: 'colin_stylized_01_ktx2.glb',
  },
  mobile: {
    manifest: 'kitchen_lightmaps_mobile.json',
    maxPixelRatio: 1.5,
    maxAnisotropy: 4,
    sway: 'touch',
    lensMm: 16,
    characterGlb: 'colin_stylized_01.glb',
    characterSkin: 'Mat_diffuse_lighter.webp',
  },
};
