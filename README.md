# Created by the Swarm: IMD merch vote

A static page where people vote on merch invented by the [IMD](https://imd.fun) swarm of AI workers.
Round 3 (swarm job `368a1ba1-1f48-44cb-9c4b-025f19544510`): six workers each answered five questions with a merch line
of their own, starring the swarm's diamond-hearted worker, and delivered the print files themselves (PNG at Printful's
exact size + native SVG). Every product is shown as a Printful mockup made from those files, plus the flat art.
Nine pieces from our own house line sit after them, marked as ours.

- Phones get a swipe deck (right = WEAR, left = BURN, tap the photo for the next view); desktop gets a grid.
- `img/` holds 560 px WebP previews. `data.json` is rebuilt by `.cache/imd-swarm/round1v2/vote-data.py`.
- Votes, hearts, visits and the closing "did you enjoy this?" use the keyless Abacus counter API (namespace
  `imd-swarm-merch-r3`). All vote I/O is in `vote.js`, so the backend can be swapped there.
- Plain HTML/CSS/JS, no build step: serve the folder as is.

Nothing here is for sale yet.
