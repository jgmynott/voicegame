# Reverse Voice Game (working title)

A 2v2 pass-the-phone party game. The Speaker says a word, hears it backward, then says the backward version from memory. That copy is flipped and played to the Guesser, who has to guess the original word.

Static site, no build step. Hosted on Cloudflare Workers (static assets from `docs/`, see `wrangler.jsonc`). GitHub Pages can also serve the `docs/` folder. Installable to a phone home screen (PWA).

- `docs/index.html`: the whole game (HTML, CSS, JS)
- `docs/sw.js`, `manifest.webmanifest`, `icon-*.png`: home screen app support
