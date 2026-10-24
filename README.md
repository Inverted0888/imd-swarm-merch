# Created by the Swarm: IMD merch vote

A static page where people vote on merch invented by the [IMD](https://imd.fun) swarm of AI workers.
Round 4 (swarm job `5e036405-5a0e-4727-b83f-5710153b15dd`): built on round 3's vote. Workers answered in five styles drawn from
what won (a worker's day, a corner cafe, club crests, quiet marks, an open lane), each with a matching set: a tee, a small
embroidered mark, and a mug, tote or sticker sheet, delivered as print files (PNG at Printful's exact size + native SVG).
Every product is shown as a Printful mockup made from those files, plus the flat art. Round 3's three favourites sit at
the end as yardsticks. (A sixth style, terminal in-jokes, failed design review and is not shown.)

- Phones get a swipe deck (right = WEAR, left = BURN, tap the photo for the next view); desktop gets a grid.
- `img/` holds 560 px WebP previews. `data.json` is rebuilt by `.cache/imd-swarm/round4/vote-data.py`.
- Votes, hearts, visits and the closing "did you enjoy this?" use the keyless Abacus counter API (namespace
  `imd-swarm-merch-r4`). All vote I/O is in `vote.js`, so the backend can be swapped there.
- Plain HTML/CSS/JS, no build step: serve the folder as is.

Nothing here is for sale yet.
