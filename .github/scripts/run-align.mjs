// Hands one job from the Python step to the aligner the app already has.
//
// Kept apart from `align_essays.py` on purpose: Python is where the model runs
// and node is where the manifest format lives, and neither should have to learn
// the other's half.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
console.log(`baking ${job.id} — "${job.title}"`);
execFileSync('node', [
  'scripts/align-narration.mjs',
  job.audio,
  job.text,
  '--words', job.words,
  '--id', job.id,
  '--title', job.title,
  '--voice', 'Colin, recorded',
], { stdio: 'inherit' });
