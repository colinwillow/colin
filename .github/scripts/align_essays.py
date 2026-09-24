"""Find the recordings in essays/, and work out when every word was said.

Whisper is a speech recogniser: you give it audio and it gives you back the
words WITH THE TIME EACH ONE WAS SPOKEN, which is the only part we want. The
transcript itself is thrown away — the real text is sitting next to the audio in
a .txt, typed by the person who read it, and it is better than anything a
recogniser will produce. What cannot be typed by hand is the timing, and that is
what makes his mouth follow the recording instead of guessing at it.

Writes one job file per essay into .narration-jobs/ for the node step to pick
up. Doing the work here and the writing there keeps each half in the language
that already knows how to do it.
"""
import json
import os
import pathlib
import sys

AUDIO = {".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac"}
ESSAYS = pathlib.Path("essays")
JOBS = pathlib.Path(".narration-jobs")
OUT = pathlib.Path("public/narration")

only = (os.environ.get("ONLY") or "").strip()
force = (os.environ.get("FORCE") or "").lower() == "true"

pairs = []
for audio in sorted(ESSAYS.glob("*")):
    if audio.suffix.lower() not in AUDIO:
        continue
    if only and audio.stem != only:
        continue
    text = audio.with_suffix(".txt")
    if not text.exists():
        text = audio.with_suffix(".md")
    if not text.exists():
        print(f"skipping {audio.name}: no {audio.stem}.txt beside it")
        continue
    pairs.append((audio, text))

if not pairs:
    print("no recordings to do")
    JOBS.mkdir(exist_ok=True)
    sys.exit(0)

# Imported here so that a run with nothing to do does not pay for it.
from faster_whisper import WhisperModel  # noqa: E402

# `small` is the sweet spot: `base` drifts on long sentences and `medium` takes
# four times as long for timings that are no better. int8 on CPU is what makes
# it run at roughly ten times real time on a runner.
model = WhisperModel("small", device="cpu", compute_type="int8")

JOBS.mkdir(exist_ok=True)
for audio, text in pairs:
    slug = audio.stem.lower().replace("_", "-").replace(" ", "-")
    if (OUT / f"{slug}.json").exists() and not force:
        print(f"{audio.name}: already made, skipping (use the Force option to redo)")
        continue

    print(f"{audio.name}: listening…", flush=True)
    segments, info = model.transcribe(str(audio), word_timestamps=True, vad_filter=False)
    words = []
    for segment in segments:
        for w in (segment.words or []):
            word = w.word.strip()
            if word:
                words.append({"word": word, "start": round(w.start, 3), "end": round(w.end, 3)})

    if not words:
        print(f"{audio.name}: nothing heard — is the recording silent?")
        continue

    stem = JOBS / slug
    (stem.with_suffix(".words.json")).write_text(json.dumps({"segments": [{"words": words}]}))
    title = audio.stem.replace("_", " ").replace("-", " ").strip().title()
    (stem.with_suffix(".json")).write_text(json.dumps({
        "audio": str(audio),
        "text": str(text),
        "words": str(stem.with_suffix(".words.json")),
        "id": slug,
        "title": title,
    }))
    print(f"{audio.name}: {len(words)} words over {words[-1]['end']:.1f}s → {slug}")
