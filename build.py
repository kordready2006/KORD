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


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("'", "").replace("’", "")).strip("-")


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


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
                chain = chains.get(norm(s["name"]))
                if chain and not s.get("local"):
                    titles = {norm(d["title"]) for d in deals}
                    for x in chain.get("deals", []):
                        d = clean_deal(x, national=True)
                        if d and norm(d["title"]) not in titles:
                            deals.append(d)
                town["spots"].append({
                    "id": sid, "name": s["name"], "category": s.get("category") if s.get("category") in CATS else "Other",
                    "local": bool(s.get("local")), "signature": bool(s.get("signature")), "address": s.get("address") or "",
                    "website": s.get("website") or (chain or {}).get("website", ""), "blurb": s.get("blurb") or "",
                    "price": s.get("price") or "", "sourceUrl": s.get("sourceUrl") or "", "deals": deals})

    pending = sorted(t["name"] for t in towns.values() if not t["spots"])
    live = [t for t in towns.values() if t["spots"]]
    live.sort(key=lambda t: (REGION_ORDER.index(t["region"]) if t["region"] in REGION_ORDER else 9, t["id"] != "athens", t["name"]))
    out = {"researchedOn": researched, "towns": live}
    with open(os.path.join(ROOT, "data", "kord.json"), "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    frag = open(os.path.join(ROOT, "app", "kord.html")).read()
    head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
            '<meta name="theme-color" content="#FF3B2F">\n<meta name="apple-mobile-web-app-capable" content="yes">\n'
            '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n<meta name="apple-mobile-web-app-title" content="KORD">\n'
            '<meta name="description" content="The best food deals in every Ohio college town, day by day.">\n'
            '<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="icons/icon.svg" type="image/svg+xml">\n'
            '<link rel="apple-touch-icon" href="icons/icon-180.png">\n'
            '<style>:root{padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n'
            '</head>\n<body>\n')
    tail = ("\n<script>if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(function(){});</script>\n</body>\n</html>\n")
    with open(os.path.join(ROOT, "index.html"), "w") as f:
        f.write(head + frag + tail)

    spots = sum(len(t["spots"]) for t in live)
    deals = sum(len(s["deals"]) for t in live for s in t["spots"])
    print(f"{len(live)} towns, {sum(len(t['colleges']) for t in live)} colleges, {spots} spots, {deals} deals")
    for t in live:
        print(f"  {t['region']:16} {t['name']:20} {len(t['spots']):3} spots {sum(len(s['deals']) for s in t['spots']):3} deals")
    if pending:
        print("No spots yet (hidden from the app):", ", ".join(pending))


if __name__ == "__main__":
    main()
