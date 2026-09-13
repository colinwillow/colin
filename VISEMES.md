# His face

`colin.glb` carries the whole character — body, outfit, headphones, head, eyes
and teeth on one skeleton — so there is no head graft any more, no second rig to
fit, and no second set of face textures. What follows is what the face has and
who is allowed to move it.

## The three meshes

| mesh | shapes | what it owns |
|---|---|---|
| `head` | 42 | the visemes, the brows, the blinks, the cheeks — and `Colin_Head_MIX` |
| `eyes` | 5 | `Look_Left` / `Look_Right` / `Look_Up` / `Look_Down`, `Cross_Eyed` |
| `teeth` | 1 | `Jaw_Open` |

**`Colin_Head_MIX` is a base shape, not an expression.** It has to sit at 1 for
his head to be the right head, so `src/face.ts` writes it every frame and no
layer is allowed to touch it. Measured at the shipped framing, dropping it moves
about 0.5% of his pixels — it is a refinement rather than a transformation, but
it is his, and it costs nothing to hold.

**One name opens the jaw and the teeth together.** The head's shape is
`Jaw_Open_MIX` and the teeth's is `Jaw_Open`; names are matched with punctuation,
case and the export's `MIX` suffix stripped, so both canonicalise to the same key
and a single `want('Jaw_Open', v)` reaches both. That is what stops his teeth
staying shut through an O or a pucker, where the lips part and nothing behind
them does.

## Everything asks, one place writes

Several things want the face at the same time — a viseme, a blink, a raised brow,
a glance — and if each wrote morph influences directly they would cancel each
other out. So each frame runs in a fixed order:

```
face.beginFrame()   everything back to rest, except the base shape
talk.update(dt)     the mouth asks for its viseme and its jaw
alive.update(dt)    blinks, gaze and brow drift ask for theirs
face.commit()       the collected result is written once
```

Between the clear and the write, layers call `want(name, value)` and the highest
bid for a given shape wins — so a blink at 1 is never undone by an expression
that also has an opinion about the eyelid.

## What moves on its own

`src/face.ts`, in the panel under **Face**:

- **Blinks.** Fast shut (55 ms), brief hold, slower open (115 ms) — the closing
  is almost instant on a real face and the opening is what you actually perceive.
  Every 3.2–9 s, and 30% of the time it doubles, because a face that blinks on a
  perfectly even schedule reads as a metronome. Measured: about one every 3.6 s.
- **Gaze.** Mostly small saccades around wherever he is pointed, with a larger
  break-off a quarter of the time. Eyes snap and then sit still; they do not
  glide. `alive.lookAt(x, y)` overrides it, and the conversation uses that to put
  his eyes on you for as long as he is answering.
- **Brows.** Two slow sine waves at rates that never line up, so the brows are
  never quite still and never obviously cycling. Small on purpose.
- **Expressions.** `neutral`, `listening`, `thinking`, `amused`, `doubtful`,
  `surprised` — weights on shapes that already exist. Understated, because they
  run underneath a mouth that is doing something else, and anything strong enough
  to read on its own reads as a grimace in motion. `thinking` goes on while the
  model is out; `listening` while you are mid-sentence.

## What is missing

- **No tongue shapes in this export.** The `L` viseme is the lip shape and the
  jaw alone, which reads fine, since the tongue only shows on a wide-open L.
  If a tongue mesh arrives with its own shapes, `RIG_CC.L` in `src/visemes.ts`
  is the one line to extend.
- No `Cross_Eyed` consumer yet. It is there when something wants it.
