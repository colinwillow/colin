// What a sound is doing, as numbers something can be drawn from.
//
// Ported from the analyser in `colinwillow/glorp` — the orb — because that one
// reacts and this one did not, and the reason is entirely in here rather than in
// the drawing. Four things come out: how loud, what shape, how bright, and
// whether something just started.
//
// THE FLOOR IS THE ROOM, AND IT MOVES. This is the whole difference.
//
// A meter keyed to a FIXED threshold is wrong in both directions at once: in a
// quiet room the needle sits a quarter of the way up doing nothing, and a normal
// speaking voice — about -30 dBFS at arm's length, barely a few dB over the
// ambient — uses a sliver of the range. So the floor is measured instead, as a
// percentile of the recent past.
//
// A percentile, specifically, rather than a minimum. A minimum tracker is pinned
// by a single quiet instant — a gap between two words, a moment of gain riding —
// and stays there. The 20th percentile of four seconds is the ROOM: while
// nobody is talking that is the air, and while somebody is talking it is STILL
// the air, because the gaps between words are more of the take than the words
// are. Speech cannot desensitise it and one quiet frame cannot deafen it.
//
// Above that floor, a small margin rejects the room and a modest range reaches
// full scale. Both are small on purpose: measured against a floor that IS the
// room, a phone at arm's length reads about 6 dB over it, and the large numbers
// that worked against a fixed floor throw the entire voice away.

export interface Features {
  /** 0–1 loudness above the room's own floor, with attack and release. */
  level: number;
  /** Per-band energy, 0–1, spaced so a voice fills the whole row. */
  bands: Float32Array;
  /** 0–1: how bright the sound is. Vowels sit low, sibilance high. */
  centroid: number;
  /** 0–1: something just started. Spectral flux, held then decayed. */
  impulse: number;
  /** 0–1: how noisy rather than tonal. Zero crossings — "s" against "ah". */
  texture: number;
  /** The measured room level, in dBFS. Mostly for the console. */
  floorDb: number;
  /** True while the analyser is actually producing something. */
  live: boolean;
}

export interface FeatureReader {
  features: Features;
  /** Read one frame. Safe to call with null, which decays everything to rest. */
  read: (analyser: AnalyserNode | null) => void;
}

/** How far over the room a sound has to be before it counts, and how much
 *  louder again reaches the top. Both small: see the note above. */
const MARGIN_DB = 2;
const RANGE_DB = 18;
/** Fast up, slower down — the asymmetry every meter has, and the reason a peak
 *  stays on screen long enough to be seen. */
const ATTACK = 0.34;
const RELEASE = 0.16;
/** Four seconds of loudness history at 60 fps, which is what the floor reads. */
const HISTORY = 240;
/** Below this there is no signal, only room tone — and all three timbre
 *  channels read HIGH on near-silence rather than low, because the zero-crossing
 *  rate of quiet noise is high, flux fires on FFT jitter, and the centroid of
 *  noise is arbitrary. Ungated, a silent room looks like a cymbal. */
const GATE = 0.05;

export function createFeatureReader(bandCount = 3): FeatureReader {
  const features: Features = {
    level: 0,
    bands: new Float32Array(bandCount),
    centroid: 0,
    impulse: 0,
    texture: 0,
    floorDb: -55,
    live: false,
  };

  let freq: Uint8Array<ArrayBuffer> | null = null;
  let time: Float32Array<ArrayBuffer> | null = null;
  let previous: Float32Array | null = null;

  const history = new Float32Array(HISTORY);
  let at = 0;
  let filled = 0;
  let tick = 0;

  const read = (analyser: AnalyserNode | null) => {
    if (!analyser) {
      features.live = false;
      features.level *= 0.9;
      features.impulse *= 0.9;
      for (let i = 0; i < features.bands.length; i++) features.bands[i] *= 0.9;
      return;
    }
    const bins = analyser.frequencyBinCount;
    if (!freq || freq.length !== bins) {
      freq = new Uint8Array(bins);
      previous = new Float32Array(bins);
      time = new Float32Array(analyser.fftSize);
    }
    analyser.getByteFrequencyData(freq);
    analyser.getFloatTimeDomainData(time!);
    features.live = true;

    // --- how loud, and how noisy ---
    let sum = 0;
    let crossings = 0;
    let last = time![0];
    for (let i = 0; i < time!.length; i++) {
      const s = time![i];
      sum += s * s;
      if ((s >= 0) !== (last >= 0)) crossings++;
      last = s;
    }
    const rms = Math.sqrt(sum / time!.length);
    const db = 20 * Math.log10(rms + 1e-7);

    history[at] = db;
    at = (at + 1) % HISTORY;
    if (filled < HISTORY) filled++;
    /* Sorted at about 10 Hz rather than every frame. The room does not move
       fast enough to care, and a 240-element sort per frame on a phone does. */
    if (++tick >= 6) {
      tick = 0;
      const recent = Array.from(history.subarray(0, filled)).sort((a, b) => a - b);
      features.floorDb = recent[Math.floor(recent.length * 0.2)];
    }

    const want = Math.min(1, Math.max(0, (db - (features.floorDb + MARGIN_DB)) / RANGE_DB));
    features.level += (want - features.level) * (want > features.level ? ATTACK : RELEASE);

    // --- what shape, and how bright ---
    let weighted = 0;
    let total = 0;
    let flux = 0;
    for (let i = 0; i < bins; i++) {
      const v = freq[i] / 255;
      weighted += i * v;
      total += v;
      const rise = v - previous![i];
      if (rise > 0) flux += rise;
      previous![i] = v;
    }

    /* Bands spaced by the SQUARE of the index rather than evenly. The FFT's bins
       are linear in frequency, which puts everything anyone says in the bottom
       eighth of them; squaring gives the low end the room it needs and lumps the
       thin top together, which is roughly how hearing works and exactly what
       makes three bands read as bass, middle and top. */
    const n = features.bands.length;
    for (let b = 0; b < n; b++) {
      const lo = Math.floor(Math.pow(b / n, 2) * bins);
      const hi = Math.max(lo + 1, Math.floor(Math.pow((b + 1) / n, 2) * bins));
      let acc = 0;
      for (let i = lo; i < hi; i++) acc += freq[i];
      const value = acc / (hi - lo) / 255;
      features.bands[b] += (value - features.bands[b]) * 0.35;
    }

    // Stretched: a speaking voice's centroid lives in about 0.03–0.25 of the
    // spectrum, so the raw number uses a tenth of its own range.
    let centroid = total > 0.001 ? weighted / total / bins : 0;
    centroid = Math.min(1, Math.max(0, (centroid - 0.03) / 0.2));

    const gate = Math.min(1, Math.max(0, (features.level - GATE) / 0.12));
    features.centroid += (centroid * gate - features.centroid) * 0.06;
    features.texture += (Math.min(1, (crossings / time!.length) * 26) * gate - features.texture) * 0.16;
    // Held, then decayed: an onset that lasted one frame should still be visible
    // for a few, which is what makes a consonant land rather than flicker.
    features.impulse = Math.max(features.impulse * 0.86, Math.min(1, flux * 0.05) * gate);
  };

  return { features, read };
}
