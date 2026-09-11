# Visemes to sculpt

Nine blendshapes on the full-body mesh, and the graft goes away.

`viseme-reference.png` is the picture of all ten positions, rendered off the
current grafted head so you can see what each one is meant to be. `rest` is the
neutral mesh, so there are **nine shapes to sculpt**.

## The set

Preston Blair's ten, which has been the working set for hand-drawn animation
since the forties because it is the fewest that still reads as speech. `etc` is
the generic consonant — every sound the mouth barely changes for — and `rest` is
the closed idle.

| Shape | Name to export | Sounds | What it is |
|---|---|---|---|
| rest | *(neutral mesh)* | — | Closed, at ease. Not clamped shut — a rest between two words is a mouth relaxing, not a mouth sealing. |
| MBP | `viseme_MBP` | m b p | Lips pressed together. The one shape that closes the mouth mid-word. |
| FV | `viseme_FV` | f v | Top teeth on the bottom lip. |
| E | `viseme_E` | e | Wide, corners pulled out, jaw a third open. |
| AI | `viseme_AI` | a i | The big one. Jaw well open, corners neutral. |
| O | `viseme_O` | o | Round, jaw half open, lips funnelled forward. |
| U | `viseme_U` | u | Smaller and rounder than O, more pucker, less jaw. |
| WQ | `viseme_WQ` | w q | Tightest pucker, jaw nearly closed. |
| L | `viseme_L` | l | Jaw open with the tongue tip up behind the teeth. Worth the tongue — it is the only shape where it shows. |
| etc | `viseme_etc` | c d g k n r s t th y z | The in-between consonant: jaw slightly open, corners slightly wide. Not a strong shape. |

## Things worth knowing before you sculpt

**Put the jaw in the shape.** With a purpose-sculpted set, each shape *is* the
mouth position — jaw included. The code drives a separate jaw channel only for
rigs that need a vowel reconstructed out of parts, and it turns that channel off
when it sees this set, so nothing opens twice.

**Weight 1 is the pose.** Nothing gets calibrated, scaled or mixed. Whatever you
sculpt at full strength is exactly what appears on screen when that sound is
spoken, so sculpt the pose you want to see rather than an ingredient. That is the
whole reason this set beats the Character Creator one: on the grafted head, MBP
was lifting the bottom lip 4.75% of the mouth's width where the rig intended
1.8%, and the code had to measure the mesh and correct it.

**A shape only ever shows for about 55–90 ms.** Under 55 ms it cannot be seen at
all, so the code never lets one run shorter than that. That means shapes want to
be readable at a glance and a little stronger than feels right in isolation —
they are never held.

**Adjacent identical shapes merge.** "ough" is one hold, not four flickers, and
"ll" in *hello* is one longer L. So there is no need to sculpt variants.

**WQ is nearly U.** If nine is one too many, sculpt U and copy it tighter.

## Exporting

Name them exactly as the table says — matching is case-insensitive and ignores
punctuation, so `viseme_MBP`, `Viseme.MBP` and `visemeMbp` all land. The code
picks this rig automatically when it finds at least 85% of the names, and logs
which rig it chose:

```
visemes: sculpted nine rig, jaw shape none
```

If it says `Character Creator` or `ARKit` instead, the names did not match.

## Turning the face back on

`src/main.ts` has `USE_HEAD_GRAFT = false`. With the shapes on the body mesh
there is no graft to turn back on — delete the flag, the `graftHead` call, and
`src/head.ts`, and point `createConversation` at the body instead. Everything in
`src/visemes.ts`, `src/voice.ts`, `src/listen.ts` and `src/brain.ts` is
independent of which mesh carries the shapes.
