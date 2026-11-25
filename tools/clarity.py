# Clarity score: how hard a word or phrase is to understand when the AI voice plays it backward.
# Lower is easier. Built from CMU dictionary pronunciations.
#
# Reversed speech keeps plain vowels (ah, ee, oo) and plain consonants recognizable, but it scrambles:
#  - diphthongs: the glide runs the wrong way, so "ai" (nightingale) sounds like "ee-ah", "oi" like "ee-oh"
#  - r-colored vowels (er, ar, or): the r comes out before the vowel
#  - consonant clusters: "str" becomes "rts"
#  - l after a vowel (dark l), ng, and reduced "uh" vowels, which go mushy
#  - many words in one phrase (each word boundary is a place to get lost)
import re, cmudict

CMU = cmudict.dict()
VOW = re.compile(r"^[A-Z]+[012]$")
DIPH = {"AY": 2.0, "OY": 2.0, "AW": 2.0, "EY": 1.0, "OW": 1.0}
WEIGHTS = {"rvowel": 1.0, "cluster": 0.6, "dark_l": 0.6, "ng": 0.5, "schwa": 0.3, "word": 0.6, "syl": 0.4}

def phones(text):
    out = []
    for w in text.lower().replace("’", "'").split():
        w = w.strip(".,!?\"")
        for c in (w, w.replace("'", ""), w[:-2] if w.endswith("'s") else None, w.replace("-", "")):
            if c and c in CMU:
                out.append(CMU[c][0]); break
        else:
            return None
    return out

def score(text):
    """Returns (score, syllables) or None when a word is not in the dictionary."""
    ws = phones(text)
    if ws is None: return None
    s, syl = 0.0, 0
    for p in ws:
        base = [re.sub(r"\d", "", x) for x in p]
        isv = [bool(VOW.match(x)) for x in p]
        syl += sum(isv)
        run = 0
        for i, (b, v) in enumerate(zip(base, isv)):
            if v:
                s += DIPH.get(b, 0)
                if b == "ER": s += WEIGHTS["rvowel"]
                if b == "AH" and p[i].endswith("0"): s += WEIGHTS["schwa"]
                nxt = base[i + 1] if i + 1 < len(base) else None
                if nxt == "R": s += WEIGHTS["rvowel"]
                if nxt == "L" and (i + 2 >= len(base) or not isv[i + 2]): s += WEIGHTS["dark_l"]
                if run > 1: s += WEIGHTS["cluster"] * (run - 1)
                run = 0
            else:
                run += 1
                if b == "NG": s += WEIGHTS["ng"]
        if run > 1: s += WEIGHTS["cluster"] * (run - 1)
    s += WEIGHTS["word"] * (len(ws) - 1) + WEIGHTS["syl"] * max(0, syl - 2)
    return round(s, 2), syl

def hard_diphthong(text):
    """True when the text has an "ai", "oi" or "ow" sound, the glides that reverse worst."""
    ws = phones(text) or []
    return any(re.sub(r"\d", "", x) in ("AY", "OY", "AW") for p in ws for x in p)

if __name__ == "__main__":
    import sys
    for w in sys.argv[1:] or ["nightingale", "banana", "pizza", "cucumber", "a blessing in disguise", "manatee", "dictionary", "polar bear", "piece of cake", "coconut"]:
        print(w, score(w))
