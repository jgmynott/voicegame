import json, random, re, sys, os
sys.path.insert(0, os.path.dirname(__file__))
import cmudict, geonamescache
from lists import *

MULTI = """fire engine|fire hydrant|mail carrier|police officer|bus driver|construction worker|flight attendant|rock star|security guard|taxi driver|tour guide|truck driver|fairy godmother|mad scientist|personal trainer|news reporter|talk show host|game show host|lunch lady|crossing guard|ice cream man|pizza delivery guy|blue jay|grizzly bear|guinea pig|hermit crab|komodo dragon|mountain goat|polar bear|sea lion|golden retriever|german shepherd|bald eagle|snow leopard|red panda|killer whale|blue whale|great white shark|tree frog|box turtle|sea turtle|black bear|brown bear|mountain lion|pack rat|field mouse|barn owl|snowy owl|apple pie|barbecue sauce|cheddar cheese|chicken nugget|cinnamon roll|clam chowder|cotton candy|french toast|fruit salad|garlic bread|hash browns|hot dog|ice cream|jelly bean|lobster bisque|noodle soup|onion ring|orange juice|pasta salad|peanut butter|pork chop|potato chip|pumpkin pie|rice pudding|root beer float|scrambled eggs|sweet potato|tomato soup|turkey sandwich|avocado toast|banana bread|blueberry muffin|buffalo wings|caesar salad|chocolate chip cookie|corn dog|egg roll|fish taco|french fries|fried chicken|grilled cheese|hot sauce|key lime pie|lemon meringue|mac and cheese|mashed potatoes|mozzarella sticks|orange chicken|peach cobbler|pecan pie|potato salad|pot roast|rocky road|shepherds pie|spring roll|strawberry shortcake|sugar cookie|tater tots|tuna melt|veggie burger|whipped cream|deep fried|chocolate covered|extra spicy|double decker|upside down|alarm clock|barbecue grill|baseball bat|bowling ball|bubble wrap|cardboard box|cash register|cassette tape|cell phone|coffee maker|cowboy hat|crystal ball|cuckoo clock|diamond ring|drum set|ferris wheel|fire engine|fire hydrant|flip flops|frying pan|garbage truck|garden hose|hockey stick|hot tub|ice skates|jack in the box|jigsaw puzzle|lawn mower|magnifying glass|music box|paper clip|pencil sharpener|pinball machine|pogo stick|popcorn machine|remote control|rocket ship|roller skates|rubber duck|sleeping bag|snow globe|tennis racket|traffic light|video game|vacuum cleaner|walkie talkie|washing machine|water balloon|water bottle|yo yo|hot air balloon|roller coaster|time machine|treasure chest|magic carpet|birthday cake|disco ball|lava lamp|fidget spinner|game controller|jet ski|monster truck|pirate ship|vending machine|brand new|glow in the dark|solar powered|remote controlled""".split("|")
MULTI = set(MULTI)

def items(s):
    t = s.split(); out = []; i = 0
    while i < len(t):
        for n in (4, 3, 2):
            p = " ".join(t[i:i+n])
            if n > 1 and p in MULTI:
                out.append(p); i += n; break
        else:
            out.append(t[i]); i += 1
    return list(dict.fromkeys(out))

CMU = cmudict.dict()
NUMS = {"sixty": 2, "six": 1, "wrinkly":2,"slippery":3,"capybara":4,"coyote":3,"dragonfly":3,"meerkat":2,"narwhal":2,"seahorse":2,"stingray":2,"toucan":2,"warthog":2,"wildebeest":3,"fire":1,"spring":1,"springs":1,"baklava":3,"broccoli":3,"bruschetta":3,"chimichanga":4,"quesadilla":4,"smoothie":2,"tapioca":4,"meringue":2,"camera":3,"hairbrush":2,"hairdryer":3,"lunchbox":2,"metronome":3,"sharpener":3,"stapler":2,"korea":3,"las":1,"national":3,"charleston":2,"charles":1,"ivory":3,"tanzania":4,"hampshire":2,"every":2,"ireland":2,"mauritania":5,"somalia":4,"skateboarder":3,"snowboarder":3,"lumberjack":3,"paramedic":4,"weatherman":3,"babysitter":4,"zookeeper":3,"godmother":3,"caveman":2}
def wsyl(w):
    w = w.lower().replace("’", "'").strip(".,!?")
    if w in NUMS: return NUMS[w]
    cands = [w, w.replace("'", ""), w.rstrip("s'") if w.endswith("'s") else w]
    for c in cands:
        if c in CMU:
            counts = {sum(ph[-1].isdigit() for ph in pr) for pr in CMU[c]}
            if len(counts) == 1: return counts.pop()
            return None  # ambiguous pronunciation
    return None
def syl(phrase):
    total = 0
    for w in re.split(r"[\s\-]+", phrase):
        if not w: continue
        n = wsyl(w)
        if n is None: return None
        total += n
    return total

random.seed(7)
# Recognizable things only: real names, places, titles, brands and plain nouns.
# No adjective + noun combos, and no syllable limit (every entry is kept, filed by syllable count).
from lists2 import PEOPLE as FAMOUS, CHARACTERS, MOVIES_TV, BRANDS, PLACES_EXTRA, SPORTS
CATS_ORDER = ["Places", "People", "Characters", "Movies & TV", "Brands", "Sports", "Animals", "Food", "Things", "Sayings"]
out = {c: {} for c in CATS_ORDER}
dropped = []; seen = set()
VOW = re.compile(r"[aeiouy]+")
def guess_syl(w):
    w = re.sub(r"[^a-z]", "", w.lower())
    if not w: return 0
    if w.isdigit(): return 1
    n = len(VOW.findall(w))
    if w.endswith("e") and not w.endswith(("le", "ee", "ie", "ye")) and n > 1: n -= 1
    return max(1, n)
def syl_any(phrase):
    total = 0
    for w in re.split(r"[\s\-]+", phrase):
        if not re.search(r"[A-Za-z0-9]", w): continue
        n = wsyl(w)
        total += n if n is not None else guess_syl(w)
    return total
def add(cat, phrase, cap=None):
    phrase = phrase.strip()
    k = phrase.lower()
    if not phrase or k in seen: return False
    n = syl_any(phrase)
    if n < 1: dropped.append(phrase); return False
    seen.add(k); out[cat].setdefault(n, []).append(phrase); return True

for p in SAYINGS.split("|"): add("Sayings", p)
for p in FAMOUS.split("|"): add("People", p)
for p in CHARACTERS.split("|"): add("Characters", p)
for p in MOVIES_TV.split("|"): add("Movies & TV", p)
for p in BRANDS.split("|"): add("Brands", p)
for p in SPORTS.split("|"): add("Sports", p)
for p in PLACES_EXTRA.split("|"): add("Places", p)
for p in LANDMARKS.split("|"): add("Places", p)
for n_ in items(ANIMALS): add("Animals", n_)
for n_ in items(FOODS): add("Food", n_)
for n_ in items(THINGS): add("Things", n_)

g = geonamescache.GeonamesCache()
ascii_ok = lambda s: re.fullmatch(r"[A-Za-z .'\-]+", s) is not None
for c in g.get_countries().values():
    if ascii_ok(c["name"]) and int(c.get("population") or 0) >= 4000000 and c["name"] not in ("Serbia and Montenegro",): add("Places", c["name"])
for s_ in g.get_us_states().values(): add("Places", s_["name"])
for c in sorted(g.get_cities().values(), key=lambda c: -c["population"]):
    if not ascii_ok(c["name"]): continue
    if c["countrycode"] == "US" and c["population"] >= 350000:
        add("Places", c["name"])

out = {c: v for c, v in out.items() if v}
json.dump({c: {str(k): v for k, v in sorted(b.items())} for c, b in out.items()},
          open(sys.argv[1], "w"), separators=(",", ":"))
open(os.path.join(os.path.dirname(__file__), "dropped.txt"), "w").write("\n".join(dropped))
