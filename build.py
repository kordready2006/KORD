#!/usr/bin/env python3
"""Build KORD: merge the researched region files into data/kord.json and wrap app/kord.html into index.html.

Usage: python3 build.py
"""
import glob
import json
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
DISHES = [("stromboli", r"stromboli"), ("cheesesteak", r"cheesesteak"), ("shawarma", r"shawarma"), ("chilidog", r"chili dog|hot dog|coney"), ("fish", r"\bfish\b"),
          ("taco", r"taco"), ("wings", r"wing"), ("gyro", r"gyro"), ("burger", r"burger"), ("pizza", r"pizza|slice"), ("sandwich", r"sandwich|\bsubs?\b"),
          ("apps", r"appetizer|\bapps\b|sharable|shareable|snack|munchies|flatbread|happy hour|late.night")]


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


def clean_deal(d, national=False):
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
                town["spots"].append({
                    "id": sid, "name": name, "category": s.get("category") if s.get("category") in CATS else "Other",
                    "local": bool(s.get("local")), "signature": bool(s.get("signature")), "address": s.get("address") or "",
                    "website": sites.get(t["id"] + "|" + s["name"]) or s.get("website") or (chain or {}).get("website", "") or brand, "blurb": s.get("blurb") or "",
                    "price": s.get("price") or "", "sourceUrl": s.get("sourceUrl") or "", "deals": deals})

    live = []
    for tid, name, abbr, col, ink, url, also in SCHOOLS:
        t = towns[tid]
        t["school"] = {"name": name, "abbr": abbr, "color": col, "ink": ink, "url": url, "also": also}
        if os.path.exists(os.path.join(ROOT, "logos", "schools", tid + ".png")):
            t["school"]["logo"] = "logos/schools/" + tid + ".png"
        for sp in t["spots"]:  # site icons fetched by tools/fetch_logos.py
            host = re.sub(r"^www\.", "", re.sub(r"^https?://([^/]+).*$", r"\1", sp["website"])) if sp["website"] else ""
            if host and os.path.exists(os.path.join(ROOT, "logos", "spots", host + ".png")):
                sp["logo"] = "logos/spots/" + host + ".png"
            if host and os.path.exists(os.path.join(ROOT, "photos", host + ".jpg")):  # the restaurant's own photo, see data/place_photos.json
                sp["photo"] = "photos/" + host + ".jpg"
            for dl in sp["deals"]:  # a photo of the dish the deal is for, when the restaurant's site has one
                text = (dl["title"] + " " + dl["details"]).lower()
                for key, rx in DISHES:
                    if host and re.search(rx, text) and os.path.exists(os.path.join(ROOT, "photos", host + "--" + key + ".jpg")):
                        dl["photo"] = "photos/" + host + "--" + key + ".jpg"
                        break
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
    # The hosted page loads the app script from its own file; the Claude preview keeps it inline in app/kord.html.
    m = re.search(r"<script>\n(.*)</script>\s*$", frag, re.S)
    with open(os.path.join(ROOT, "app.js"), "w") as f:
        f.write(m.group(1) + "\nif ('serviceWorker' in navigator && /^https:/.test(location.href) && !/htmlpreview/.test(location.host)) navigator.serviceWorker.register('sw.js').catch(function () {});\n")
    with open(os.path.join(ROOT, "index.html"), "w") as f:
        f.write(head + frag[:m.start()] + '<script src="app.js"></script>\n</body>\n</html>\n')

    for t in live:
        print(f"{t['school']['name']:34} {len(t['spots']):3} places {sum(len(x['deals']) for x in t['spots']):3} deals")
    print(len(live), "schools,", sum(len(t["spots"]) for t in live), "places,", sum(len(x["deals"]) for t in live for x in t["spots"]), "deals")


if __name__ == "__main__":
    main()
