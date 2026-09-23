# His personality

`colin.md` is what he is told he is. It is **not** loaded by this app — it lives
in the Cloudflare Worker that answers him, so changing it means pasting it, not
deploying this repo.

## Putting a change live

Cloudflare dashboard → Workers & Pages → `orb-brain` → Settings → Variables →
`ORB_PERSONA_COLIN`. Paste the whole of `colin.md` in and save.

That variable **wins over everything** — over the copy compiled into the Worker
and over any later Worker deploy — so it takes effect immediately, needs no
build, and can be done from a phone.

Check it took by opening:

    https://orb-brain.colinwillowtree.workers.dev/persona?as=colin

which prints the model in use and the exact prompt he is being given. It says
`(persona from the dashboard variable)` when the paste has landed.

## Why the file is here and not only in glorp

`colinwillow/glorp` holds the Worker and the original `worker/persona-colin.md`,
which is the compiled-in fallback. This copy is the one being edited against a
working character, so when the two drift, this is the newer one — worth copying
back over glorp's file and redeploying when convenient, so the fallback is not a
worse version of him.

## Judging a change

`npm run persona-check` — from a machine with internet, not from a sandboxed
session. It checks whether what is live is what is in this file, then asks him
about thirty things and prints every answer.

**The flags are not the point and the printed answers are.** It catches the four
failures that have a shape:

- **calling himself software** — "a computer", "an AI", "just a program". The
  one that broke, and there is no acceptable phrasing of it, including the
  self-deprecating joke. Answering honestly when somebody *asks* whether he is a
  real person is the rule rather than a fault, so that is not flagged.
- **guessing at what you are looking at** — "the site?", "your screen". He
  cannot see anything.
- **describing his own manner** — "I'm being blunt", "I sound irritated". Being
  annoyed is a way of saying a sentence, not a thing to announce.
- **going helpful-assistant** — "how can I help", "let me know if".

Plus anything over 55 words, which is a monologue.

Everything else is a judgement call and the answers are printed in full so you
can make it. `--rounds 3` runs the bank three times, which is how you tell a bad
default from one unlucky roll; `--only vague` runs one group. `--self-test`
checks the flags themselves against a table of lines that should and should not
trip them, offline, so they cannot quietly stop catching anything.

## What he is told about the moment

The page sends a little state with every question, which the document tells him
what to do with:

- `mood` — `feeling`, `valence` and `energy`, from `src/mood.ts`. What the last
  few minutes did to him.
- `where` — the room he is actually standing in, written as he would say it
  ("his kitchen — a stool, a little table, a fridge, one pendant lamp, a
  window"). It comes off the scene table in `src/stage.ts`.
- `time` — the local time where the conversation is happening.

`where` exists because of the failure that prompted this revision. Given nothing
to grab — "I'm just checking some stuff out" — he reached for the only thing he
could think of, which was the screen, and called himself a computer. A room with
a fridge in it and a clock that says four in the morning are two things to reach
for instead.

## A note on length

The Worker runs him on a small, fast model, and a long document is material it
tries to *cover* rather than a person it tries to be. glorp's own notes record a
cut from 2,582 words to about 1,700 that fixed exactly that — listy, reciting
answers.

This revision is about 3,400, up from 3,160, and all of the added weight is
worked exchanges and physical detail rather than description — the two kinds of
material that transfer. Description of a character produces a summary of that
character; a room with a fridge in it produces somebody mentioning a fridge.

If he starts reciting again, the first things to cut are the philosophy in §6
and the taste notes in §8: they are the sections with nothing in a normal
conversation to attach to, so they get recited or not used at all. §6 has
already been cut once for exactly that.
