# Builds docs/clear.json: the words Free play draws from, the ones that stay clear when played backward.
# A word is kept if it has at most 4 syllables and a clarity score of 3.0 or less (see clarity.py).
# Each category also keeps at least its 40 easiest words, so small categories (Sayings, Sports) still work.
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from clarity import score

root = os.path.join(os.path.dirname(__file__), "..")
words = json.load(open(os.path.join(root, "docs", "words.json")))
MAX_SCORE, MAX_SYL, MIN_PER_CAT = 3.0, 4, 40
keep = set()
for cat, levels in words.items():
    rows = sorted((r[0], w) for lst in levels.values() for w in lst if (r := score(w)) and r[1] <= MAX_SYL)
    for i, (s, w) in enumerate(rows):
        if s <= MAX_SCORE or i < MIN_PER_CAT: keep.add(w.lower())
with open(os.path.join(root, "docs", "clear.json"), "w") as f:
    json.dump(sorted(keep), f, separators=(",", ":"))
print(len(keep), "words")
