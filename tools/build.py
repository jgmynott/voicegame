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
out = {c: {} for c in ["Places", "Animals", "Food", "Things", "People", "Sayings"]}
dropped = []
def add(cat, phrase, cap=None):
    n = syl(phrase)
    if n is None: dropped.append(phrase); return False
    if not 3 <= n <= 8: return False
    b = out[cat].setdefault(n, [])
    if phrase in b or (cap and len(b) >= cap): return False
    b.append(phrase); return True

# Sayings and landmarks are curated
for p in SAYINGS.split("|"): add("Sayings", p)
for p in LANDMARKS.split("|"): add("Places", p)

# Places from geonames: countries, US states, big cities, US cities + state
g = geonamescache.GeonamesCache()
ascii_ok = lambda s: re.fullmatch(r"[A-Za-z .'\-]+", s) is not None
for c in g.get_countries().values():
    if ascii_ok(c["name"]): add("Places", c["name"])
states = {k: v["name"] for k, v in g.get_us_states().items()}
for s in states.values(): add("Places", s)
cities = sorted(g.get_cities().values(), key=lambda c: -c["population"])
countries = {k: v["name"] for k, v in g.get_countries().items()}
for c in cities:
    if not ascii_ok(c["name"]): continue
    if c["countrycode"] == "US" and c["population"] >= 60000:
        add("Places", c["name"]); st = states.get(c.get("admin1code"))
        if st: add("Places", f'{c["name"]} {st}')
    elif c["population"] >= 400000:
        add("Places", c["name"])
        cn = countries.get(c["countrycode"])
        if cn and ascii_ok(cn) and c["population"] >= 1000000: add("Places", f'{c["name"]} {cn}')

# Combos for animals, food, things: adjective + noun, filling every syllable level evenly
def fill(cat, nouns, adjs, per_level):
    nouns = items(nouns); adjs = items(adjs)
    for n_ in nouns: add(cat, n_)
    combos = [f"{a} {n_}" for a in adjs for n_ in nouns]
    random.shuffle(combos)
    for p in combos: add(cat, p, cap=per_level)
fill("Animals", ANIMALS, ANIMAL_ADJ, 600)
fill("Food", FOODS, FOOD_ADJ, 600)
fill("Things", THINGS, THING_ADJ, 600)
fill("People", PEOPLE, PEOPLE_ADJ, 600)

total = 0
for cat, b in out.items():
    counts = {k: len(v) for k, v in sorted(b.items())}; s = sum(counts.values()); total += s
    print(cat, s, counts)
print("TOTAL", total, "dropped(unknown/ambiguous words):", len(dropped))
for b in out.values():
    for k in b: b[k] = [re.sub(r"\bi\b", "I", p) for p in b[k]]
json.dump({c: {str(k): v for k, v in sorted(b.items())} for c, b in out.items()},
          open(sys.argv[1], "w"), separators=(",", ":"))
open(os.path.join(os.path.dirname(__file__), "dropped.txt"), "w").write("\n".join(dropped))
