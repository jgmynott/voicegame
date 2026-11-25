# BackWords

A 2v2 party game, played on everyone's own phone or by passing one phone around. The Speaker says a word, hears it backward, then says the backward version from memory. That copy is flipped and played to the Guesser, who has to guess the original word.

No build step. Hosted on Cloudflare Workers: static files from `docs/`, plus `src/worker.js`, a small game server (one Durable Object per room code) for online play. See `wrangler.jsonc`. Run locally with `npx wrangler dev`. Installable to a phone home screen (PWA).

- `docs/index.html`: the whole game client (HTML, CSS, JS)
- `src/worker.js`: room server for online play
- `docs/sw.js`, `manifest.webmanifest`, `icon-*.png`: home screen app support

## Daily BackWord

One word a day (midnight New York time), the same for everyone. The Worker picks it from
`src/daily-words.js` (built by `tools/daily.py`, not served publicly), voices it with
Workers AI text-to-speech, caches the clip for the day, and checks guesses at `/api/daily/guess`.
Players get 5 guesses, a new hint after each miss, a "say it back and flip" helper, stats,
a streak and a share button.
