// Render an essay once, keep the audio, never pay for it again.
//
// The conversation has to be synthesised on every turn because nobody can
// pre-record an answer to a question nobody has asked. An essay is the same
// words every time, so paying per play — in credits, in latency, in a network
// that may not be there — is paying repeatedly for something that only had to
// happen once. This does it once and commits the result.
//
//   node scripts/bake-narration.mjs essays/separation.md --dry
//   node scripts/bake-narration.mjs essays/separation.md --title "The Illusion of Separation"
//
// --dry SPENDS NOTHING and prints what the real run would cost: the character
// count, the parts, and roughly how long it will be. Run it first. Every time.
//
// It writes public/narration/<id>/NNN.mp3, public/narration/<id>.json and an
// entry in public/narration/index.json. All of it is committed — that is the
// whole point.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const argv = process.argv.slice(2);
/* Named so the parser knows which words are values and which are the file.
   `--title "The Illusion of Separation"` puts a bare string in the middle of
   the arguments, and without this list it gets taken for the essay. */
const TAKES_VALUE = ['brain', 'persona', 'out', 'id', 'title', 'voice', 'note', 'chars'];
const flags = new Map();
const bare = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { bare.push(a); continue; }
  const name = a.slice(2);
  if (TAKES_VALUE.includes(name)) { flags.set(name, argv[++i] ?? ''); }
  else flags.set(name, true);
}
const flag = (name) => flags.get(name) === true;
const opt = (name, fallback) => (flags.has(name) && flags.get(name) !== true ? flags.get(name) : fallback);
const source = bare[0];

if (!source) {
  console.log('usage: node scripts/bake-narration.mjs <essay.md> [--dry] [--id x] [--title "…"]');
  process.exit(1);
}

const BRAIN = opt('brain', 'https://orb-brain.colinwillowtree.workers.dev');
const PERSONA = opt('persona', 'colin');
const OUT = opt('out', 'public/narration');
const ID = opt('id', basename(source, extname(source)).toLowerCase().replace(/[^a-z0-9-]+/g, '-'));
const DRY = flag('dry');

/**
 * How much text goes in one request.
 *
 * Not the engine's limit, which is far higher — a size chosen for three other
 * reasons. Playback can start once the FIRST part has arrived rather than once
 * the whole essay has; only a couple of parts are ever decoded at a time, where
 * twenty minutes of PCM would be a couple of hundred megabytes on a phone; and
 * a seam falls at a paragraph break, which is where a breath belongs. Each
 * request is still conditioned on its neighbours, so the prosody carries
 * across.
 */
const PART_CHARS = Number(opt('chars', 700));

/** Strip the markdown down to what a person would actually read out. */
function readable(md) {
  return md
    .replace(/```[\s\S]*?```/g, '')                       // code blocks: not read
    .replace(/^\s*#{1,6}\s+/gm, '')                       // headings, kept as text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                 // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')              // links → their text
    .replace(/[*_`>]/g, '')
    .replace(/^\s*[-–—]\s*$/gm, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Paragraphs first, then sentences — a seam at a paragraph break is free. */
function chunk(text, cap) {
  const out = [];
  for (const para of text.split(/\n{2,}/)) {
    const clean = para.trim().replace(/\n/g, ' ');
    if (!clean) continue;
    if (clean.length <= cap) { out.push(clean); continue; }
    const sentences = clean.match(/[^.!?…]+(?:[.!?…]+["')\]]*\s*|\s*$)/g) ?? [clean];
    let cur = '';
    for (const s of sentences) {
      if (cur && (cur + s).length > cap) { out.push(cur.trim()); cur = s; }
      else cur += s;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

const text = readable(readFileSync(source, 'utf8'));
const parts = chunk(text, PART_CHARS);
const chars = parts.reduce((n, p) => n + p.length, 0);
const words = text.split(/\s+/).filter(Boolean).length;
/* 150 words a minute is an unhurried read of prose. Only an estimate — the real
   duration is measured below from what actually came back. */
const estimate = (words / 150) * 60;
const mmss = (s) => `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;

console.log(`${source}`);
console.log(`  ${words} words · ${chars} characters · ${parts.length} parts · about ${mmss(estimate)} of audio`);
console.log(`  at 1 credit per character that is ${chars.toLocaleString()} credits, once — check your plan's rate`);

if (DRY) {
  console.log('\n--dry: nothing was sent and nothing was spent.');
  console.log('first part:');
  console.log(`  ${parts[0].slice(0, 300)}${parts[0].length > 300 ? '…' : ''}`);
  console.log(`last part:`);
  console.log(`  ${parts.at(-1).slice(0, 300)}${parts.at(-1).length > 300 ? '…' : ''}`);
  process.exit(0);
}

const dir = join(OUT, ID);
mkdirSync(dir, { recursive: true });

/** One request. `prev` and `next` are what keep the prosody continuous across
 *  a seam — the engine conditions this part on its neighbours. */
async function render(body, prev, next) {
  const res = await fetch(new URL('/speak', BRAIN), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: body, persona: PERSONA, prev: prev || undefined, next: next || undefined, marks: 1 }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const type = res.headers.get('content-type') ?? '';
  if (!/json/i.test(type)) {
    // Without marks there is no lip sync worth the name, and finding that out
    // after twenty minutes of credits is the wrong time.
    throw new Error(`expected JSON with alignment, got ${type || 'nothing'} — the Worker did not honour marks:1`);
  }
  const json = await res.json();
  const marks = json.normalized_alignment ?? json.alignment ?? null;
  if (!marks) throw new Error('no alignment in the response');
  return { audio: Buffer.from(json.audio_base64 ?? '', 'base64'), marks };
}

/** Times to the millisecond. Finer than the mouth can show and a third of the
 *  bytes of a full float. */
const round = (a) => (a ?? []).map((n) => Math.round(n * 1000) / 1000);

const manifest = {
  id: ID,
  title: opt('title', ID.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())),
  voice: opt('voice', 'the voice engine'),
  words,
  duration: 0,
  note: opt('note', ''),
  parts: [],
};

let total = 0;
for (let i = 0; i < parts.length; i++) {
  const name = `${String(i + 1).padStart(3, '0')}.mp3`;
  const file = join(dir, name);
  let piece;
  try {
    piece = await render(parts[i], parts[i - 1] ?? '', parts[i + 1] ?? '');
  } catch (err) {
    console.log(`\npart ${i + 1} failed: ${err.message}`);
    console.log(`${i} parts were written. Fix it and run again — the parts already`);
    console.log('written will be overwritten, so nothing is spent twice by accident');
    console.log('only if you re-run the whole thing.');
    process.exit(1);
  }
  writeFileSync(file, piece.audio);
  /* The engine's own last character time is the length of the part, near
     enough — the player re-measures from the decoded buffer anyway, and this is
     only used to find which part a seek lands in. */
  const ends = piece.marks.character_end_times_seconds ?? [];
  const duration = ends.length ? ends[ends.length - 1] : 0;
  total += duration;
  manifest.parts.push({
    audio: `${ID}/${name}`,
    text: parts[i],
    duration: Math.round(duration * 1000) / 1000,
    marks: {
      characters: piece.marks.characters ?? [],
      character_start_times_seconds: round(piece.marks.character_start_times_seconds),
      character_end_times_seconds: round(ends),
    },
  });
  const kb = Math.round(statSync(file).size / 1024);
  process.stdout.write(`\r  part ${i + 1}/${parts.length} · ${kb} KB · ${mmss(total)} so far   `);
}
process.stdout.write('\n');

manifest.duration = Math.round(total * 1000) / 1000;
writeFileSync(join(OUT, `${ID}.json`), `${JSON.stringify(manifest, null, 1)}\n`);

// And the index the app reads, kept in one place rather than hand-edited.
const indexFile = join(OUT, 'index.json');
let index = [];
if (existsSync(indexFile)) { try { index = JSON.parse(readFileSync(indexFile, 'utf8')); } catch { index = []; } }
const entry = { id: ID, title: manifest.title, duration: manifest.duration, voice: manifest.voice, words };
if (manifest.note) entry.note = manifest.note;
index = index.filter((r) => r.id !== ID).concat(entry).sort((a, b) => a.title.localeCompare(b.title));
writeFileSync(indexFile, `${JSON.stringify(index, null, 1)}\n`);

console.log(`\nwrote ${OUT}/${ID}.json — ${mmss(total)}, ${parts.length} parts, ${chars.toLocaleString()} characters spent`);
console.log('commit it. It never needs making again.');
