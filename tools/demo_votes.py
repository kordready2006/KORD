"""NOTE: this only works before server/accounts.sql has been run (it uses the old device-based functions).

Fill the shared ratings server with DEMO votes and comments so the app can be previewed with data in it.

  python3 tools/demo_votes.py

Every demo row uses a device id that starts with dede0000, and demo comments are posted under the name "Demo".
Remove them all before launch by running this in the Supabase SQL Editor:

  delete from ratings  where device::text like 'dede0000%';
  delete from comments where device::text like 'dede0000%';
"""
import json
import os
import random
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cfg = json.load(open(os.path.join(ROOT, "data", "server.json")))
data = json.load(open(os.path.join(ROOT, "data", "kord.json")))
menus = json.load(open(os.path.join(ROOT, "data", "menus.json")))
random.seed(7)
COMMENTS = ["Huge portion for the price.", "Solid, would get it again.", "Best thing on the menu.", "Good but go on deal night.",
            "Great late-night pick.", "A little salty but filling.", "Worth the walk.", "Get extra sauce.", "Underrated.", "Fine, nothing special."]


def call(fn, body):
    req = urllib.request.Request(cfg["url"] + "/rest/v1/rpc/" + fn, data=json.dumps(body).encode(), method="POST",
                                 headers={"apikey": cfg["key"], "Authorization": "Bearer " + cfg["key"], "Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=30).read()
        return True
    except Exception:
        return False


def device(n):
    return "dede0000-0000-4000-8000-%012d" % n


jobs = []
for t in data["towns"]:
    local = [s for s in t["spots"] if s["local"]]
    with_menu = [s for s in local if menus.get(s["id"])]
    for sp in random.sample(with_menu, min(14, len(with_menu))) + [s for s in local if s["deals"] and not menus.get(s["id"])][:4]:
        dishes = [d["title"] for d in sp["deals"]][:2] + [m["n"] for m in random.sample(menus.get(sp["id"], []), min(6, len(menus.get(sp["id"], []))))]
        quality = random.uniform(6.2, 9.4)   # each place has its own level so the standings spread out
        for dish in dishes:
            if not 1 <= len(dish) <= 80:
                continue
            voters = random.sample(range(1, 400), random.randint(1, 7))
            for v in voters:
                stars = max(1, min(10, round(random.gauss(quality, 1.3))))
                jobs.append(("rate_dish", {"p_device": device(v), "p_town": t["id"], "p_place": sp["id"], "p_dish": dish, "p_stars": stars}))
            if random.random() < 0.3:
                jobs.append(("add_comment", {"p_device": device(random.randint(400, 5000)), "p_town": t["id"], "p_place": sp["id"], "p_dish": dish,
                                             "p_name": "Demo", "p_body": random.choice(COMMENTS)}))

with ThreadPoolExecutor(8) as ex:
    ok = list(ex.map(lambda j: call(*j), jobs))
print(sum(ok), "of", len(jobs), "demo rows written:", sum(1 for j in jobs if j[0] == "rate_dish"), "votes,", sum(1 for j in jobs if j[0] == "add_comment"), "comments")
