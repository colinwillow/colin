# Readings

Nothing here is generated at build time. Each reading is **made once and
committed**, because the words do not change and paying per play — in credits,
in latency, in a network that might not be there — is paying repeatedly for
something that only had to happen once.

    public/narration/
      index.json          what the app lists
      separation.json     one reading: its parts and their timings
      separation/
        001.mp3 002.mp3 … the audio, in parts

## Making one from a phone

Put the recording and the words in `essays/` and push. That is all of it — the
`Bake a reading` workflow does the rest and commits the result, which makes the
site rebuild.

    essays/my-essay.mp3    what you read out
    essays/my-essay.txt    the words you read

The names only have to be close: `my-essay-audio.mp3` finds `my-essay.txt`, and
if there is one recording and one text it pairs them whatever they are called.
If it cannot find the words for a recording it fails and says so, rather than
going green having done nothing — which is what it did the first time.

*Actions → Bake a reading → Run workflow* redoes one by hand, with a **Force**
box for re-doing one that already exists.

## Making one from a machine

```bash
# from the voice engine. --dry spends nothing and tells you what the real run costs.
npm run bake-narration -- essays/separation.md --dry
npm run bake-narration -- essays/separation.md --title "The Illusion of Separation"

# or from a recording of the actual Colin, which costs nothing and, for
# fifteen minutes of prose, sounds better.
whisperx reading.mp3 --model large-v3 --output_format json
npm run align-narration -- reading.mp3 essays/separation.md --words reading.json
```

Both write the same thing and the player cannot tell them apart.

## Why it is in parts

Not a compromise — three things fall out of it. Playback starts when the first
forty seconds has arrived rather than when twenty minutes has. Only a part or
two is ever decoded at a time, where a whole essay as PCM is a couple of hundred
megabytes on a phone. And the seams land at paragraph breaks, where a breath
belongs anyway.

## The format

```json
{
  "id": "separation",
  "title": "The Illusion of Separation",
  "voice": "Colin, recorded",
  "words": 2250,
  "duration": 912.4,
  "parts": [
    {
      "audio": "separation/001.mp3",
      "text": "the words in this part, for captions and for the fallback",
      "duration": 41.2,
      "marks": {
        "characters": ["e", "v", "…"],
        "character_start_times_seconds": [0.0, 0.041],
        "character_end_times_seconds": [0.041, 0.09]
      }
    }
  ]
}
```

`marks` is the shape the voice engine returns, and `src/visemes.ts` turns it
into mouth shapes without caring where it came from — which is the whole reason
a recording of a real person gets the same lip sync as a synthesised one. `null`
falls back to guessing the mouth from `text` spread over the audio, which is
what you get from a recording that was never aligned.

Times are relative to the start of **that part**, not the whole reading.
