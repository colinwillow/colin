// The same thing, from a recording of the actual Colin.
//
// Fifteen minutes is where a voice clone comes apart. It is convincing for two
// sentences and tiring by minute four, because the artefacts do not average
// out, they accumulate — so for anything long, the real voice reading the real
// essay is both better and free. The clone is for conversation, which is the
// one thing that genuinely cannot be recorded in advance.
//
// AND THE LIP SYNC COSTS NOTHING EITHER, which is the part that is easy to
// assume is bought rather than made. `src/visemes.ts` builds the mouth from a
// list of characters with start and end times; it does not care who produced
// them. Run the recording through a forced aligner — it has the text already,
// so this is alignment rather than recognition, and far more accurate — and the
// word timings become character timings here.
//
//   whisperx reading.mp3 --model large-v3 --output_format json
//   node scripts/align-narration.mjs reading.mp3 essays/separation.md \
//     --words reading.json --title "The Illusion of Separation"
//
// Without --words it still works and the mouth is a guess spread over the
// duration, which is worth doing once to see the thing running before
// installing anything.
//
// ffmpeg, if present, splits the recording into parts so that playback can
// start early and only a minute of audio is ever decoded at a time. Without it
// the whole recording is one part, which works and costs a phone some memory.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const TAKES_VALUE = ['words', 'text', 'out', 'id', 'title', 'voice', 'note', 'seconds', 'duration'];
const flags = new Map();
const bare = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { bare.push(a); continue; }
  const name = a.slice(2);
  if (TAKES_VALUE.includes(name)) flags.set(name, argv[++i] ?? '');
  else flags.set(name, true);
}
const opt = (n, d) => (flags.has(n) && flags.get(n) !== true ? flags.get(n) : d);

const [audioFile, textFile] = bare;
if (!audioFile) {
  console.log('usage: node scripts/align-narration.mjs <recording.mp3> [essay.md] [--words whisper.json] [--title "…"]');
  process.exit(1);
}

const OUT = opt('out', 'public/narration');
const ID = opt('id', basename(audioFile, extname(audioFile)).toLowerCase().replace(/[^a-z0-9-]+/g, '-'));
/** Seconds per part. The same reasoning as the bake: playback starts early and
 *  the decoded audio never adds up. */
const PART_SECONDS = Number(opt('seconds', 45));

/**
 * How long an MP3 is, by walking its frames.
 *
 * ffprobe knows this and ffprobe is not installed on most machines, which is a
 * silly reason for the whole thing to stop — so the frames are counted here.
 * Every MP3 frame header carries its own bitrate and sample rate, and every
 * frame is a fixed number of samples, so the length is the sum of the frames
 * and it is exact for a variable-bitrate file as well as a constant one.
 *
 * Null for anything that is not an MP3, which falls back to ffprobe and then to
 * --duration.
 */
function mp3Seconds(file) {
  let buf;
  try { buf = readFileSync(file); } catch { return null; }
  let i = 0;
  // An ID3v2 tag sits in front of the audio and its size is seven bits a byte.
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    i = 10 + ((buf[6] & 0x7f) << 21 | (buf[7] & 0x7f) << 14 | (buf[8] & 0x7f) << 7 | (buf[9] & 0x7f));
  }
  const V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
  const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  let seconds = 0;
  let frames = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const version = (buf[i + 1] >> 3) & 3;          // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (buf[i + 1] >> 1) & 3;            // 1 = Layer III
    const bitrate = (version === 3 ? V1 : V2)[(buf[i + 2] >> 4) & 15] * 1000;
    const rate = RATES[version]?.[(buf[i + 2] >> 2) & 3];
    if (layer !== 1 || version === 1 || !bitrate || !rate) { i++; continue; }
    const samples = version === 3 ? 1152 : 576;
    const size = Math.floor((samples / 8) * bitrate / rate) + ((buf[i + 2] >> 1) & 1);
    if (size < 4) { i++; continue; }
    seconds += samples / rate;
    frames++;
    i += size;
  }
  return frames > 4 ? seconds : null;
}

const has = (cmd) => {
  try { execFileSync(cmd, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
};
const FFMPEG = has('ffmpeg');
const FFPROBE = has('ffprobe');

/**
 * Word timings out of whatever the aligner produced.
 *
 * Three shapes, because the three tools anybody reaches for write three
 * different files and none of them is going to change for us: WhisperX and
 * faster-whisper nest words inside segments, whisper.cpp writes a flat
 * transcription with millisecond offsets, and a hand-made file is usually just
 * the array.
 */
function readWords(file) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const out = [];
  const push = (word, start, end) => {
    const w = String(word ?? '').trim();
    if (!w || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return;
    out.push({ word: w, start, end });
  };
  if (Array.isArray(json.segments)) {
    for (const seg of json.segments) {
      if (Array.isArray(seg.words)) for (const w of seg.words) push(w.word ?? w.text, w.start, w.end);
      else push(seg.text, seg.start, seg.end);
    }
  } else if (Array.isArray(json.transcription)) {
    // whisper.cpp, in milliseconds. `--max-len 1` is what makes it per-word.
    for (const t of json.transcription) push(t.text, (t.offsets?.from ?? 0) / 1000, (t.offsets?.to ?? 0) / 1000);
  } else if (Array.isArray(json)) {
    for (const w of json) push(w.word ?? w.text, w.start, w.end);
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Characters and their times, from words and theirs.
 *
 * Spread evenly inside each word — which sounds crude and is not, because
 * nothing downstream needs per-letter accuracy: `timelineFromMarks` collapses
 * runs of one shape and then enforces a minimum hold, so the only thing that
 * has to be right is WHICH WORD is being said when. What matters much more is
 * the gap BETWEEN words: a space wide enough is what closes his mouth, and
 * without it he chews continuously through every pause in the reading.
 */
function marksFromWords(words, from, to) {
  const characters = [];
  const starts = [];
  const ends = [];
  let last = from;
  for (const w of words) {
    if (w.end <= from || w.start >= to) continue;
    const s = Math.max(from, w.start);
    const e = Math.min(to, w.end);
    if (e <= s) continue;
    if (s > last) { characters.push(' '); starts.push(last - from); ends.push(s - from); }
    const step = (e - s) / w.word.length;
    for (let i = 0; i < w.word.length; i++) {
      characters.push(w.word[i]);
      starts.push(s - from + i * step);
      ends.push(s - from + (i + 1) * step);
    }
    last = e;
  }
  if (to > last) { characters.push(' '); starts.push(last - from); ends.push(to - from); }
  const round = (a) => a.map((n) => Math.round(n * 1000) / 1000);
  return { characters, character_start_times_seconds: round(starts), character_end_times_seconds: round(ends) };
}

const words = flags.has('words') ? readWords(opt('words')) : [];
let duration = Number(opt('duration', 0));
if (!duration && /\.mp3$/i.test(audioFile)) duration = mp3Seconds(audioFile) ?? 0;
if (!duration && FFPROBE) {
  duration = Number(execFileSync('ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', audioFile],
    { encoding: 'utf8' }).trim());
}
if (!duration && words.length) duration = words[words.length - 1].end;
if (!duration) {
  console.log('could not work out how long the recording is. Install ffmpeg, or pass --duration <seconds>.');
  process.exit(1);
}

/* What he actually said, from whichever of the three is there. Without ANY of
   them there is nothing to move a mouth with: no word timings means the mouth
   is spread over the text instead, and no text means it is spread over
   nothing. A silent face over a perfectly good recording is a confusing thing
   to be handed, so this stops instead. */
const spoken = (opt('text', '') || (textFile && existsSync(textFile) ? readFileSync(textFile, 'utf8') : '')
  || words.map((w) => w.word).join(' ')).replace(/\s+/g, ' ').trim();
if (!spoken) {
  console.log('nothing to move his mouth with. Give it the words as well as the audio:');
  console.log('  …align-narration.mjs reading.mp3 passage.txt');
  console.log('  …align-narration.mjs reading.mp3 --text "the passage you read out"');
  console.log('  …align-narration.mjs reading.mp3 --words whisper.json   (best: real timings)');
  process.exit(1);
}

/* Where to cut. At a sentence end near the target length when the words are
   known, because a seam at a full stop is inaudible and a seam mid-clause is
   not; on the clock when they are not. */
const cuts = [0];
if (words.length) {
  let mark = 0;
  for (const w of words) {
    if (w.end - mark < PART_SECONDS) continue;
    if (!/[.!?…]["')\]]*$/.test(w.word) && w.end - mark < PART_SECONDS * 1.6) continue;
    cuts.push(w.end);
    mark = w.end;
  }
} else {
  for (let t = PART_SECONDS; t < duration - 5; t += PART_SECONDS) cuts.push(t);
}
cuts.push(duration);

const dir = join(OUT, ID);
mkdirSync(dir, { recursive: true });
const ext = extname(audioFile) || '.mp3';

const parts = [];
const single = !FFMPEG || cuts.length <= 2;
if (single) {
  const name = `001${ext}`;
  copyFileSync(audioFile, join(dir, name));
  parts.push({ audio: `${ID}/${name}`, from: 0, to: duration });
  if (!FFMPEG) {
    console.log('ffmpeg not found: kept as one part. It works — a long one will just');
    console.log('hold more memory on a phone while it plays.');
  }
} else {
  for (let i = 0; i < cuts.length - 1; i++) {
    const name = `${String(i + 1).padStart(3, '0')}${ext}`;
    // Re-muxed, not re-encoded: no generation loss and no wait.
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', audioFile,
      '-ss', String(cuts[i]), '-to', String(cuts[i + 1]), '-c', 'copy', join(dir, name)]);
    parts.push({ audio: `${ID}/${name}`, from: cuts[i], to: cuts[i + 1] });
    process.stdout.write(`\r  part ${i + 1}/${cuts.length - 1}   `);
  }
  process.stdout.write('\n');
}

const manifest = {
  id: ID,
  title: opt('title', ID.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())),
  voice: opt('voice', 'Colin, recorded'),
  words: spoken.split(/\s+/).filter(Boolean).length,
  duration: Math.round(duration * 1000) / 1000,
  note: opt('note', ''),
  parts: parts.map((p, i) => ({
    audio: p.audio,
    /* The words actually in this part when they are known; otherwise the whole
       text on the first part, which is what the fallback timeline needs to
       spread itself over. */
    text: words.length
      ? words.filter((w) => w.end > p.from && w.start < p.to).map((w) => w.word).join(' ')
      : (i === 0 ? spoken : ''),
    duration: Math.round((p.to - p.from) * 1000) / 1000,
    marks: words.length ? marksFromWords(words, p.from, p.to) : null,
  })),
};

writeFileSync(join(OUT, `${ID}.json`), `${JSON.stringify(manifest, null, 1)}\n`);

const indexFile = join(OUT, 'index.json');
let index = [];
if (existsSync(indexFile)) { try { index = JSON.parse(readFileSync(indexFile, 'utf8')); } catch { index = []; } }
const entry = { id: ID, title: manifest.title, duration: manifest.duration, voice: manifest.voice, words: manifest.words };
if (manifest.note) entry.note = manifest.note;
index = index.filter((r) => r.id !== ID).concat(entry).sort((a, b) => a.title.localeCompare(b.title));
writeFileSync(indexFile, `${JSON.stringify(index, null, 1)}\n`);

const mmss = (s) => `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
const kb = parts.reduce((n, p) => n + statSync(join(OUT, p.audio)).size, 0) / 1024;
console.log(`wrote ${OUT}/${ID}.json — ${mmss(duration)}, ${parts.length} part(s), ${Math.round(kb)} KB`);
console.log(words.length
  ? `${words.length} words aligned, so the mouth is following the recording`
  : 'no word timings, so the mouth is a guess spread over the duration — run a forced\naligner and pass --words to fix that');
