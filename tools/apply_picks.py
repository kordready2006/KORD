#!/usr/bin/env python3
"""Apply a person's photo choices from a reviewed crawl.
  python3 tools/apply_picks.py <crawl-dir>
Reads <crawl-dir>/sites.json and every <crawl-dir>/picks-*.json ({"S12": {"place": 3, "tag": "burger", "dishes": {"wings": 0}}}),
saves the chosen images into photos/ and records where each came from."""
import glob
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = sys.argv[1]
sites = json.load(open(os.path.join(D, "sites.json")))
pp_path, dp_path = os.path.join(ROOT, "data", "place_photos.json"), os.path.join(ROOT, "data", "deal_photos.json")
pp, dp = json.load(open(pp_path)), json.load(open(dp_path))
TAGS = {"taco", "wings", "burrito", "calzone", "tenders", "gyro", "burger", "pizza", "sandwich", "fish", "steak", "pasta", "mexplate", "bowl", "breakfast",
        "sweet", "drink", "sides", "chicken", "dips", "hotsandwich", "stromboli", "cheesesteak", "shawarma", "chilidog"}
places = dishes = 0


def save(im, name):
    img = Image.open(im["f"]).convert("RGB")
    img.thumbnail((800, 800))
    img.save(os.path.join(ROOT, "photos", name + ".jpg"), quality=80, optimize=True)


for path in sorted(glob.glob(os.path.join(D, "picks-*.json"))):
    for key, pick in json.load(open(path)).items():
        i = int(key.lstrip("S"))
        if i >= len(sites):
            continue
        site = sites[i]
        host, imgs = site["host"], site["imgs"]
        p = pick.get("place")
        if isinstance(p, int) and 0 <= p < len(imgs) and (not site["hasPhoto"] or host not in pp):
            save(imgs[p], host)
            pp[host] = {"source": imgs[p]["src"], "site": site["url"]}
            if pick.get("tag") in TAGS:
                pp[host]["dish"] = pick["tag"]
            places += 1
        for dish, n in (pick.get("dishes") or {}).items():
            if dish in TAGS and isinstance(n, int) and 0 <= n < len(imgs):
                save(imgs[n], host + "--" + dish)
                dp.setdefault(host, {})[dish] = {"source": imgs[n]["src"]}
                dishes += 1
json.dump(pp, open(pp_path, "w"), indent=1)
json.dump(dp, open(dp_path, "w"), indent=1)
print(places, "restaurant photos and", dishes, "dish photos added")
