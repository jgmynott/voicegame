# BackSlang

A 2v2 party game, played on everyone's own phone or by passing one phone around. The Speaker says a word, hears it backward, then says the backward version from memory. That copy is flipped and played to the Guesser, who has to guess the original word.

No build step. Hosted on Cloudflare Workers: static files from `docs/`, plus `src/worker.js`, a small game server (one Durable Object per room code) for online play. See `wrangler.jsonc`. Run locally with `npx wrangler dev`. Installable to a phone home screen (PWA).

- `docs/index.html`: the whole game client (HTML, CSS, JS)
- `src/worker.js`: room server for online play
- `docs/sw.js`, `manifest.webmanifest`, `icon-*.png`: home screen app support
- `docs/fonts/`: Titan One (bubble letters for the logo, headings and buttons) and Fredoka (body text), served from this site (no Google Fonts request)
- `docs/_headers`: browser cache rules for the static files (long cache for the font and icons)

The service worker serves the page network first (falling back to the cached copy after 2.5 seconds
or when offline) and everything else from cache, refreshed in the background. Bump `CACHE` in
`docs/sw.js` when its precache list changes.

## Daily BackSlang

One word a day (midnight New York time), the same for everyone. The Worker picks it from
`src/daily-words.js` (built by `tools/daily.py`, not served publicly), voices it with
Workers AI text-to-speech, caches the clip for the day, and checks guesses at `/api/daily/guess`.
Daily answers are picked to stay clear when reversed: `tools/clarity.py` scores each word from its
CMU dictionary pronunciation (diphthongs like the "ai" in nightingale, r-colored vowels, consonant
clusters, dark l, extra words and syllables all add difficulty), and `tools/daily.py` keeps only
2 to 4 syllable words with no "ai", "oi" or "ow" sound and a low score.

## Difficulty

Every category has Easy, Normal and Hard. Normal is the whole word list. `tools/levels.py` ranks each
category by clarity score and writes `docs/levels.json`: Easy is the clearest 40% (at most 4 syllables),
Hard the least clear 40%. The team game and online rooms default to Normal, Free play to Easy.

Players get 5 guesses, a new hint after each miss, a "say it back and flip" helper, stats,
a streak and a share button.
