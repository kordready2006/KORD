#!/usr/bin/env python3
"""Build KORD: merge the researched region files into data/kord.json and wrap app/kord.html into index.html.

Usage: python3 build.py
"""
import glob
import json
import time
import math
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
CATS = {"Pizza", "Burgers", "Mexican", "Sandwiches & Subs", "Wings & Chicken", "Asian", "Boba & Tea", "Coffee & Bakery",
        "Breakfast & Brunch", "Bar & Grill", "Dessert & Ice Cream", "BBQ", "Mediterranean", "Healthy & Bowls", "Fast Food", "Other"}
REGION_ORDER = ["Southeast Ohio", "Central Ohio", "Southwest Ohio", "Northeast Ohio", "Northwest Ohio"]


# The schools KORD covers: town id -> the main school shown for it. Region files hold more towns; only these are built.
SCHOOLS = [
    ("athens", "Ohio University", "OU", "#00694E", "#FFFFFF", "https://www.ohio.edu", ""),
    ("columbus", "Ohio State University", "OSU", "#BA0C2F", "#FFFFFF", "https://www.osu.edu", ""),
    ("oxford", "Miami University", "MU", "#C41230", "#FFFFFF", "https://miamioh.edu", ""),
    ("cincinnati", "University of Cincinnati", "UC", "#1A1A1A", "#FFFFFF", "https://www.uc.edu", "Xavier"),
    ("dayton", "University of Dayton", "UD", "#004B8D", "#FFFFFF", "https://udayton.edu", ""),
    ("kent", "Kent State University", "KSU", "#003976", "#EFAB00", "https://www.kent.edu", ""),
    ("bowling-green", "Bowling Green State University", "BGSU", "#FD5000", "#3B1F12", "https://www.bgsu.edu", ""),
    ("toledo", "University of Toledo", "UT", "#003E7E", "#FFD200", "https://www.utoledo.edu", ""),
    ("akron", "University of Akron", "UA", "#041E42", "#C9B67A", "https://www.uakron.edu", ""),
    ("cleveland", "Case Western Reserve University", "CWRU", "#0A304E", "#FFFFFF", "https://case.edu", "Cleveland State"),
    ("youngstown", "Youngstown State University", "YSU", "#C8102E", "#FFFFFF", "https://ysu.edu", ""),
    ("portsmouth", "Shawnee State University", "SSU", "#003A70", "#FFFFFF", "https://www.shawnee.edu", ""),
    ("delaware", "Ohio Wesleyan University", "OWU", "#8C1C13", "#FFFFFF", "https://www.owu.edu", ""),
    ("westerville", "Otterbein University", "OTT", "#B11116", "#F0DDB0", "https://www.otterbein.edu", ""),
    ("findlay", "University of Findlay", "UF", "#F47920", "#1A1A1A", "https://www.findlay.edu", ""),
]


# Dish keywords for deal-specific photos (photos/<host>--<dish>.jpg). First match wins.
DISHES = [("dips", r"crostini|guac|queso|salsa|hummus|\bdips?\b"), ("hotsandwich", r"roast beef|sloppy joe|reuben"),
          ("stromboli", r"stromboli"), ("cheesesteak", r"cheesesteak"), ("shawarma", r"shawarma"), ("chilidog", r"chili dog|hot dog|coney"),
          ("taco", r"taco"), ("wings", r"wing"), ("burrito", r"burrito|quesabirria"), ("calzone", r"calzone"), ("tenders", r"tender|finger|chunk|nugget"), ("gyro", r"gyro"),
          ("burger", r"burger|slider"), ("pizza", r"pizza|slice|\bpie\b"), ("sandwich", r"sandwich|\bsubs?\b|wrap|bagel|panini|melt"),
          ("fish", r"\bfish\b|perch|shrimp|crab|lobster|seafood|sushi|\brolls?\b"), ("steak", r"steak|prime rib|\bribs?\b|brisket|bbq"),
          ("pasta", r"pasta|spaghetti|lasagna|\bmac\b|macaroni|ravioli|noodle|ramen"), ("mexplate", r"nacho|quesadilla|fajita|enchilada|arroz"),
          ("bowl", r"bowl|salad|soup|rice"), ("breakfast", r"breakfast|brunch|pancake|waffle|\begg|omelet"),
          ("sweet", r"cookie|donut|cupcake|ice cream|custard|dessert|shake|pint|cinnamon roll|scone"), ("drink", r"coffee|latte|\btea\b|smoothie|boba|fizzimoo"),
          ("sides", r"pretzel|fries|\btots\b|cheese stick|breadstick"), ("chicken", r"chicken"),
          ("apps", r"appetizer|\bapps\b|sharable|shareable|snack|munchies|flatbread|starter|small plate|happy hour|late.night")]


# Centre of each campus (lat, lon) and how far out a place may be. 2.5 miles in a straight line is roughly a
# 10-15 minute drive in town; places further out are left out of the app.
CAMPUS = {"athens": (39.3252, -82.1013), "columbus": (40.0000, -83.0135), "oxford": (39.5087, -84.7345), "cincinnati": (39.1320, -84.5155),
          "dayton": (39.7400, -84.1790), "kent": (41.1490, -81.3415), "bowling-green": (41.3780, -83.6400), "toledo": (41.6580, -83.6140),
          "akron": (41.0760, -81.5110), "cleveland": (41.5045, -81.6085), "youngstown": (41.1065, -80.6470), "portsmouth": (38.7310, -82.9950),
          "delaware": (40.2960, -83.0650), "westerville": (40.1250, -82.9370), "findlay": (41.0530, -83.6510)}
RADIUS_MILES = 2.5


def miles(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(h))


ORDER_RX = re.compile(r"toasttab|chownow|square\.site|squareup|clover\.com|olo\.com|spoton|popmenu|slicelife|owner\.com|ordering|//order\.|/order", re.I)


# Dish photos that turned out not to show that dish when reviewed by eye; the deal shows the logo instead.
PHOTO_SKIP = {"trollpub.com--apps"}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("'", "").replace("’", "")).strip("-")


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


# Official sites for chains that are not in data/chains.json.
BRANDS = {"jetspizza": "https://www.jetspizza.com", "texasroadhouse": "https://www.texasroadhouse.com", "crackerbarrel": "https://www.crackerbarrel.com",
          "rubytuesday": "https://www.rubytuesday.com", "freddys": "https://www.freddys.com", "tudorsbiscuitworld": "https://tudorsbiscuitworld.com",
          "dpdough": "https://www.dpdough.com", "playabowls": "https://www.playabowls.com", "firstwatch": "https://www.firstwatch.com",
          "hungryhowies": "https://www.hungryhowies.com", "rallys": "https://www.rallys.com", "topperspizza": "https://www.toppers.com"}


def base_name(name):
    """Chain spot names sometimes carry a location suffix, e.g. "Subway (Marion)"."""
    return re.sub(r"\s*\([^)]*\)\s*$", "", name).strip()


def find_chain(chains, name):
    n = norm(base_name(name))
    if n in chains:
        return chains[n]
    hits = [k for k in chains if len(k) >= 5 and n.startswith(k)]
    return chains[max(hits, key=len)] if hits else None


BUDGET = 12.0  # KORD is for students eating cheap: a deal priced above this per order is left out


def deal_price(d):
    m = re.search(r"\$\s?(\d+(?:\.\d+)?)", (d.get("price") or "").strip() or d.get("title", ""))
    return float(m.group(1)) if m else None


def clean_deal(d, national=False):
    if (deal_price(d) or 0) > BUDGET:
        return None
    days = [x for x in DAYS if x in (d.get("days") or [])]
    if not days or not d.get("title") or not str(d.get("sourceUrl", "")).startswith("http"):
        return None  # a deal without days, a title or a source is not shown
    out = {"days": days, "title": d["title"].strip(), "details": (d.get("details") or "").strip(), "price": (d.get("price") or "").strip(),
           "studentOnly": bool(d.get("studentOnly")), "sourceUrl": d["sourceUrl"], "sourceDate": d.get("sourceDate") or ""}
    if national:
        out["national"] = True
    return out


def main():
    chains = {}
    chain_path = os.path.join(ROOT, "data", "chains.json")
    if os.path.exists(chain_path):
        for c in json.load(open(chain_path))["chains"]:
            chains[norm(c["name"])] = c

    sites = {}
    if os.path.exists(os.path.join(ROOT, "data", "websites.json")):
        sites = json.load(open(os.path.join(ROOT, "data", "websites.json")))
    if os.path.exists(os.path.join(ROOT, "data", "websites2.json")):
        sites.update(json.load(open(os.path.join(ROOT, "data", "websites2.json"))))
    place_tags = {}
    if os.path.exists(os.path.join(ROOT, "data", "place_photos.json")):
        place_tags = {h: v.get("dish", "") for h, v in json.load(open(os.path.join(ROOT, "data", "place_photos.json"))).items()}
    towns, researched = {}, ""
    for path in sorted(glob.glob(os.path.join(ROOT, "data", "regions", "*.json"))):
        reg = json.load(open(path))
        researched = max(researched, reg.get("researchedOn", ""))
        for t in reg.get("towns", []):
            town = towns.setdefault(t["id"], {"id": t["id"], "name": t["name"], "region": reg["region"], "colleges": [], "spots": []})
            have = {c["name"] for c in town["colleges"]}
            town["colleges"] += [c for c in t.get("colleges", []) if c["name"] not in have]
            seen = {s["id"] for s in town["spots"]}
            for s in t.get("spots", []):
                sid = t["id"] + "--" + slug(s["name"])
                if sid in seen:
                    continue
                seen.add(sid)
                deals = [d for d in (clean_deal(x) for x in s.get("deals", [])) if d]
                chain = None if s.get("local") else find_chain(chains, s["name"])
                name = s["name"] if s.get("local") else base_name(s["name"])
                brand = next((u for k, u in BRANDS.items() if norm(name).startswith(k)), "")
                if chain:
                    titles = {norm(d["title"]) for d in deals}
                    for x in chain.get("deals", []):
                        d = clean_deal(x, national=True)
                        if d and norm(d["title"]) not in titles:
                            deals.append(d)
                if not s.get("local") and any(not o["local"] and norm(o["name"]) == norm(name) for o in town["spots"]):
                    continue  # the same chain listed twice in one town
                town["spots"].append({
                    "id": sid, "name": name, "category": s.get("category") if s.get("category") in CATS else "Other",
                    "local": bool(s.get("local")), "signature": bool(s.get("signature")), "address": s.get("address") or "",
                    "website": sites.get(t["id"] + "|" + s["name"]) or s.get("website") or (chain or {}).get("website", "") or brand, "blurb": s.get("blurb") or "",
                    "price": s.get("price") or "", "sourceUrl": s.get("sourceUrl") or "", "deals": deals})

    geo = json.load(open(os.path.join(ROOT, "data", "geo.json"))) if os.path.exists(os.path.join(ROOT, "data", "geo.json")) else {}
    live, far, unknown = [], 0, 0
    for tid, name, abbr, col, ink, url, also in SCHOOLS:
        t = towns[tid]
        keep = []
        for sp in t["spots"]:
            pt = geo.get(sp["address"].strip())
            if pt:
                sp["mi"] = round(miles(CAMPUS[tid], pt), 1)
                if sp["mi"] > RADIUS_MILES:
                    far += 1
                    continue
            else:
                unknown += 1
            keep.append(sp)
        t["spots"] = keep
        t["school"] = {"name": name, "abbr": abbr, "color": col, "ink": ink, "url": url, "also": also}
        if os.path.exists(os.path.join(ROOT, "logos", "schools", tid + ".png")):
            t["school"]["logo"] = "logos/schools/" + tid + ".png"
        for sp in t["spots"]:  # site icons fetched by tools/fetch_logos.py
            host = re.sub(r"^www\.", "", re.sub(r"^https?://([^/]+).*$", r"\1", sp["website"])) if sp["website"] else ""
            if host and os.path.exists(os.path.join(ROOT, "logos", "spots", host + ".png")):
                sp["logo"] = "logos/spots/" + host + ".png"
            if host and os.path.exists(os.path.join(ROOT, "photos", host + ".jpg")):  # the restaurant's own photo, see data/place_photos.json
                sp["photo"] = "photos/" + host + ".jpg"
            tag = place_tags.get(host, "")
            for dl in sp["deals"]:
                # A photo must show the food the deal is for. The dish is read from the deal's name (then its details).
                # It gets that restaurant's own photo of that dish, or the restaurant's main photo when that photo is
                # tagged as the same dish. A deal that names a food we have no matching photo for shows the logo instead.
                # Only a deal that names no food at all (10% off with student ID) may use the restaurant's main photo.
                title, text = dl["title"].lower(), (dl["title"] + " " + dl["details"]).lower()
                dish = next((k for k, rx in DISHES if re.search(rx, title)), "") or next((k for k, rx in DISHES if re.search(rx, text)), "")
                if not dish:
                    continue
                if host and host + "--" + dish not in PHOTO_SKIP and os.path.exists(os.path.join(ROOT, "photos", host + "--" + dish + ".jpg")):
                    dl["photo"] = "photos/" + host + "--" + dish + ".jpg"
                elif tag != dish:
                    dl["nophoto"] = True
        del t["colleges"]
        live.append(t)
    out = {"researchedOn": researched, "towns": live}
    with open(os.path.join(ROOT, "data", "kord.json"), "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    frag = open(os.path.join(ROOT, "app", "kord.html")).read()
    head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
            '<meta name="theme-color" content="#FF3B2F">\n<meta name="apple-mobile-web-app-capable" content="yes">\n'
            '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n<meta name="apple-mobile-web-app-title" content="KORD">\n'
            '<meta name="description" content="The cheapest food deals near Ohio college campuses, day by day.">\n'
            '<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="icons/icon.svg" type="image/svg+xml">\n'
            '<link rel="apple-touch-icon" href="icons/icon-180.png">\n'
            '<style>:root{padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n'
            '</head>\n<body>\n')
    tail = ("\n<script>if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(function(){});</script>\n</body>\n</html>\n")
    # Menus: data/menus/<town>.json maps "town-id|place name" to its menu; the app loads them by place id.
    menus, names, order = {}, {}, {}
    for t in live:
        for sp in t["spots"]:
            names[t["id"] + "|" + norm(sp["name"])] = sp["id"]
    for path in sorted(glob.glob(os.path.join(ROOT, "data", "menus", "*.json"))):
        for key, m in json.load(open(path)).items():
            tid, _, nm = key.partition("|")
            sid = names.get(tid + "|" + norm(base_name(nm))) or names.get(tid + "|" + norm(nm))
            items = [{"n": i["name"].strip(), "p": (i.get("price") or "").strip(), "s": (i.get("section") or "Menu").strip()}
                     for i in m.get("items", []) if i.get("name") and 3 <= len(i["name"].strip()) <= 70
                     and not re.match(r"(?i)\s*(add|extra|substitute|sub)\b|.*\b(gift card|party tray|catering|gratuity|t-shirt)\b", i["name"])][:120]
            if sid and items:
                menus[sid] = items
            if sid and ORDER_RX.search(m.get("source") or ""):
                order[sid] = m["source"]
    # "Order online" links: an online-ordering page found while reading the menu, a chain's own site, or a partner
    # link from data/partners.json ({"town-id|Place name": "https://order-link-with-your-partner-code"}).
    partners = json.load(open(os.path.join(ROOT, "data", "partners.json"))) if os.path.exists(os.path.join(ROOT, "data", "partners.json")) else {}
    for t in live:
        for sp in t["spots"]:
            link = partners.get(t["id"] + "|" + sp["name"]) or order.get(sp["id"]) or ("" if sp["local"] else sp["website"])
            if not link and ORDER_RX.search(sp["website"]):
                link = sp["website"]
            if link:
                sp["order"] = link
    server = json.load(open(os.path.join(ROOT, "data", "server.json"))) if os.path.exists(os.path.join(ROOT, "data", "server.json")) else {}
    if server.get("url") and server.get("key"):
        out["server"] = {"url": server["url"], "key": server["key"]}
    with open(os.path.join(ROOT, "data", "kord.json"), "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(sum(1 for t in live for sp in t["spots"] if sp.get("order")), "places with an order link; shared server", "ON" if out.get("server") else "not configured")
    with open(os.path.join(ROOT, "data", "menus.json"), "w") as f:
        json.dump(menus, f, ensure_ascii=False, separators=(",", ":"))
    print(len(menus), "menus,", sum(len(v) for v in menus.values()), "dishes")

    # The hosted page loads the app script from its own file; the Claude preview keeps it inline in app/kord.html.
    m = re.search(r"<script>\n(.*)</script>\s*$", frag, re.S)
    # Build stamp: the app compares its own stamp with version.json on every open and reloads itself when a newer build is live.
    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    with open(os.path.join(ROOT, "version.json"), "w") as f:
        json.dump({"build": stamp}, f)
    with open(os.path.join(ROOT, "app.js"), "w") as f:
        f.write("window.KORD_BUILD = '" + stamp + "';\n" + m.group(1) + "\nif ('serviceWorker' in navigator && /^https:/.test(location.href) && !/htmlpreview/.test(location.host)) navigator.serviceWorker.register('sw.js').catch(function () {});\n")
    with open(os.path.join(ROOT, "index.html"), "w") as f:
        f.write(head + frag[:m.start()] + '<script src="app.js?v=' + stamp + '"></script>\n</body>\n</html>\n')

    print(far, "places dropped as more than", RADIUS_MILES, "miles from campus;", unknown, "kept with no mappable address")
    for t in live:
        print(f"{t['school']['name']:34} {len(t['spots']):3} places {sum(len(x['deals']) for x in t['spots']):3} deals")
    print(len(live), "schools,", sum(len(t["spots"]) for t in live), "places,", sum(len(x["deals"]) for t in live for x in t["spots"]), "deals")


if __name__ == "__main__":
    main()
