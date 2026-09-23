// The colours he is actually wearing, read off the texture.
//
// His jacket is the most interesting thing on screen — rust, ochre, teal, a
// dozen others — and the meter under him was painted from a palette somebody
// chose by eye. Sampling the jacket instead means the two match by construction,
// and they keep matching when the jacket changes: a re-export with a different
// coat moves the meter with it, with nothing here to edit.
//
// WHAT IS BEING LOOKED FOR IS NOT THE AVERAGE COLOUR. The average of that
// texture is mud — it is a whole outfit on one sheet, most of which is a beige
// hoodie and a pair of navy jeans, and averaging a rust next to a teal gives
// grey. So pixels are bucketed by HUE and weighted by how saturated they are,
// which finds the handful of colours a person would point at and ignores the
// large dull areas between them.
import * as THREE from 'three';

export interface Swatch {
  /** 0–1 each, the colour as sampled. */
  color: THREE.Color;
  /** Degrees. */
  hue: number;
  saturation: number;
  lightness: number;
  /** How much of the texture argued for this one. Only meaningful in order. */
  weight: number;
}

/** The sampling grid. Small on purpose: this is a search for broad areas of
 *  colour, and a full-resolution read would mostly find fabric weave. */
const GRID = 96;
/** Hue buckets. 36 is ten degrees each, which is about the width of a colour
 *  somebody would give a single name to. */
const BINS = 36;
/** Below these a pixel is a shade rather than a colour, and the outfit is more
 *  than half shades — the hoodie and the jeans between them. */
const MIN_SATURATION = 0.16;
const MIN_LIGHTNESS = 0.1;
const MAX_LIGHTNESS = 0.93;
/** How far apart two swatches have to be to count as different colours. */
const MIN_SEPARATION_DEG = 26;

/**
 * Pull the strongest few colours out of a texture.
 *
 * Returns nothing rather than guessing when the texture cannot be read — a
 * compressed one has no pixels to look at from JavaScript, and a palette
 * invented in that case would be a palette nobody chose. Callers keep their own
 * defaults for exactly that.
 */
export function samplePalette(texture: THREE.Texture | null, want = 6): Swatch[] {
  const image = texture?.image as CanvasImageSource & { width?: number; height?: number } | undefined;
  if (!image || !image.width || !image.height) return [];

  let data: Uint8ClampedArray;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = GRID;
    canvas.height = GRID;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];
    ctx.drawImage(image, 0, 0, GRID, GRID);
    data = ctx.getImageData(0, 0, GRID, GRID).data;
  } catch {
    // A compressed texture, or a canvas the browser will not let us read back.
    return [];
  }

  const weight = new Float64Array(BINS);
  const sum = new Float64Array(BINS * 3);
  const colour = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    colour.setRGB(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, THREE.SRGBColorSpace);
    colour.getHSL(hsl);
    if (hsl.s < MIN_SATURATION || hsl.l < MIN_LIGHTNESS || hsl.l > MAX_LIGHTNESS) continue;
    /* Saturation decides, and mid-lightness breaks the tie: a colour at the very
       top or bottom of the range is a highlight or a shadow of some other
       colour rather than a colour in its own right. */
    const w = hsl.s * (1 - Math.abs(hsl.l - 0.5) * 1.1);
    const bin = Math.min(BINS - 1, Math.floor(hsl.h * BINS));
    weight[bin] += w;
    sum[bin * 3] += colour.r * w;
    sum[bin * 3 + 1] += colour.g * w;
    sum[bin * 3 + 2] += colour.b * w;
  }

  const ranked = [...weight.keys()].sort((a, b) => weight[b] - weight[a]);
  const out: Swatch[] = [];
  for (const bin of ranked) {
    if (out.length >= want || weight[bin] <= 0) break;
    const c = new THREE.Color(
      sum[bin * 3] / weight[bin],
      sum[bin * 3 + 1] / weight[bin],
      sum[bin * 3 + 2] / weight[bin],
    );
    c.getHSL(hsl);
    const hue = hsl.h * 360;
    /* Neighbouring bins are the same colour seen twice. Without this a gradient
       across two bins wins the first three places and the palette is one hue. */
    const apart = (a: number, b: number) => {
      const d = Math.abs(a - b) % 360;
      return d > 180 ? 360 - d : d;
    };
    if (out.some((s) => apart(s.hue, hue) < MIN_SEPARATION_DEG)) continue;
    out.push({ color: c, hue, saturation: hsl.s, lightness: hsl.l, weight: weight[bin] });
  }
  return out;
}

/** Roughly: reds through yellows are warm, everything else is cool. The split
 *  is at the greens, which is where the eye puts it. */
export const isWarm = (hue: number) => hue <= 95 || hue >= 330;

/**
 * A swatch, held at a chosen lightness.
 *
 * THE LADDER IS NOT NEGOTIABLE, which is what keeps this legible: the three
 * meter lines have to stay dark / mid / light whatever colours come back, or
 * two of them land on the same value as the backdrop and disappear. What the
 * sampling decides is the HUE; the value is the interface's.
 */
export function atLightness(swatch: Swatch, lightness: number, saturation?: number): string {
  const c = new THREE.Color().setHSL(
    swatch.hue / 360,
    saturation ?? Math.min(0.85, Math.max(0.2, swatch.saturation)),
    lightness,
  );
  return `#${c.getHexString()}`;
}
