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
import re
import sys

AUDIO = {".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac"}
TEXT = {".txt", ".md"}
ESSAYS = pathlib.Path("essays")
JOBS = pathlib.Path(".narration-jobs")
OUT = pathlib.Path("public/narration")

only = (os.environ.get("ONLY") or "").strip()
force = (os.environ.get("FORCE") or "").lower() == "true"

# Things people put on the end of a recording's name and not on the end of the
# text's. Demanding that the two match exactly is a silly thing to ask of
# somebody naming files on a phone, and the first real run failed on precisely
# that: essay_test_audio.mp3 next to essay_test.txt.
NOISE = re.compile(
    r"[\s_.-]*(audio|recording|record|voice|vocals?|read(ing)?|narration|final|draft|"
    r"take[\s_-]*\d*|v\d+|\d{1,2})$",
    re.I,
)


def key(name: str) -> str:
    """A name with the differences that do not matter taken out of it."""
    before = None
    while before != name:
        before = name
        name = NOISE.sub("", name)
    return re.sub(r"[^a-z0-9]+", "", name.lower())


audios = [p for p in sorted(ESSAYS.glob("*")) if p.suffix.lower() in AUDIO]
texts = [p for p in sorted(ESSAYS.glob("*")) if p.suffix.lower() in TEXT]

if not audios:
    print("no recordings in essays/ — nothing to do")
    JOBS.mkdir(exist_ok=True)
    sys.exit(0)

by_key = {}
for t in texts:
    by_key.setdefault(key(t.stem), t)

pairs = []
orphans = []
for audio in audios:
    if only and key(audio.stem) != key(only) and audio.stem != only:
        continue
    text = (
        audio.with_suffix(".txt") if audio.with_suffix(".txt").exists()
        else audio.with_suffix(".md") if audio.with_suffix(".md").exists()
        else by_key.get(key(audio.stem))
    )
    # One of each and nothing matched: they are obviously each other's.
    if text is None and len(audios) == 1 and len(texts) == 1:
        text = texts[0]
    if text is None:
        orphans.append(audio)
        continue
    pairs.append((audio, text))

for audio in orphans:
    print(f"::error file={audio}::No text found for {audio.name}. Put the words you "
          f"read in essays/{key(audio.stem) or audio.stem}.txt — the names do not have to "
          f"match exactly, but they have to be close.")

if not pairs:
    # A green tick over a run that did nothing is the worst outcome there is:
    # it looks like it worked. There were recordings and not one of them could
    # be used, so this fails and says why.
    print("found recordings but could not use any of them")
    sys.exit(1)

# Imported here so that a run with nothing to do does not pay for it.
from faster_whisper import WhisperModel  # noqa: E402

# `small` is the sweet spot: `base` drifts on long sentences and `medium` takes
# four times as long for timings that are no better. int8 on CPU is what makes
# it run at roughly ten times real time on a runner.
model = WhisperModel("small", device="cpu", compute_type="int8")

JOBS.mkdir(exist_ok=True)
made = 0
for audio, text in pairs:
    # Named after the two of them together rather than after the recording, so
    # "essay_test_audio.mp3" does not become a reading called "Essay Test Audio".
    slug = re.sub(r"[^a-z0-9]+", "-", key(text.stem) or key(audio.stem)).strip("-")
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

    # A distinct extension, because the shell picks these up with a glob and
    # both files used to end in `.json` — so the word timings were handed to the
    # builder as if they were a job, and it ran with every argument empty.
    words_file = JOBS / f"{slug}.words.json"
    job_file = JOBS / f"{slug}.job.json"
    words_file.write_text(json.dumps({"segments": [{"words": words}]}))
    title = re.sub(r"[_-]+", " ", NOISE.sub("", text.stem)).strip().title()
    job_file.write_text(json.dumps({
        "audio": str(audio),
        "text": str(text),
        "words": str(words_file),
        "id": slug,
        "title": title,
    }))
    made += 1
    print(f"{audio.name} + {text.name}: {len(words)} words over {words[-1]['end']:.1f}s → {slug}")

if orphans:
    sys.exit(1)
print(f"{made} reading(s) ready to build")
