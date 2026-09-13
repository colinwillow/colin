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

## A note on length

The Worker runs him on a small, fast model, and a long document is material it
tries to *cover* rather than a person it tries to be. glorp's own notes record a
cut from 2,582 words to about 1,700 that fixed exactly that — listy, reciting
answers.

This revision is back up to about 2,600, and nearly all of the added weight is
worked exchanges rather than description, which is the one kind of material that
transfers. If he starts reciting again, the first things to cut are the
philosophy in §5 and the taste notes in §7: they are the sections with nothing
in a normal conversation to attach to, so they get recited or not used at all.
