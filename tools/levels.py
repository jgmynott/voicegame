# Builds docs/levels.json: which words count as Easy and which as Hard, per category.
# Normal is the whole list in words.json. Words are ranked within their category by their clarity
# score (see clarity.py; how hard the word is to follow when played backward):
#  - Easy: the clearest 40% of the category, at most 4 syllables.
#  - Hard: the least clear 40% of the category (diphthongs, r sounds, clusters, longer phrases).
# Each list keeps at least 25 words per category so small categories (Sports, Sayings) still play.
# Words the pronunciation dictionary doesn't know stay Normal only.
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from clarity import score

root = os.path.join(os.path.dirname(__file__), "..")
words = json.load(open(os.path.join(root, "docs", "words.json")))
SHARE, MIN_PER_CAT, EASY_MAX_SYL = 0.4, 25, 4
easy, hard = set(), set()
for cat, levels in words.items():
    rows = sorted((r[0], r[1], w) for lst in levels.values() for w in lst if (r := score(w)))
    n = max(MIN_PER_CAT, round(len(rows) * SHARE))
    easy |= {w.lower() for s, syl, w in [x for x in rows if x[1] <= EASY_MAX_SYL][:n]}
    hard |= {w.lower() for s, syl, w in rows[-n:]}
    print(f"{cat:12} {len(rows):4} scored  easy<= {[x for x in rows if x[1] <= EASY_MAX_SYL][:n][-1][0]}  hard>= {rows[-n:][0][0]}")
with open(os.path.join(root, "docs", "levels.json"), "w") as f:
    json.dump({"easy": sorted(easy), "hard": sorted(hard)}, f, separators=(",", ":"))
print(len(easy), "easy,", len(hard), "hard")
