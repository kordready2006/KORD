#!/usr/bin/env python3
"""Turn a crawl (tools/crawl_photos.js) into numbered contact sheets for a person to review.
  python3 tools/photo_sheets.py <crawl-dir>
Writes <crawl-dir>/sites.json and <crawl-dir>/sheet-N.png. Each row is one restaurant: its name, the dishes its deals
need a photo of, and up to 7 of its own photos (the ones whose caption or file name mentions a needed dish come first)."""
import importlib.util
import json
import os
import re
import sys

from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("build", os.path.join(ROOT, "build.py"))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)
DISHES = build.DISHES

D = sys.argv[1]
crawl = json.load(open(os.path.join(D, "crawl.json")))
sites = []
for url, v in crawl.items():
    need = []
    for title in v["deals"]:
        k = next((k for k, rx in DISHES if re.search(rx, title.lower())), "")
        if k and k != "apps" and k not in need:
            need.append(k)
    imgs = []
    for im in v["imgs"]:
        try:
            t = Image.open(im["f"])
            if t.width < 450 or t.height < 300 or t.width > t.height * 2.6 or t.height > t.width * 1.8:
                continue
            t = t.convert("RGB")
            t.thumbnail((900, 900))
            f = im["f"].replace(".bin", ".jpg")
            t.save(f, quality=82)
            label = (im.get("alt", "") + " " + im["src"].split("/")[-1] + " " + im.get("near", "")).lower()
            hits = [k for k, rx in DISHES if k != "apps" and re.search(rx, label)]
            imgs.append({"f": f, "src": im["src"], "hits": hits, "alt": im.get("alt", "")[:40]})
        except Exception:
            continue
    if not imgs:
        continue
    imgs.sort(key=lambda x: (0 if set(x["hits"]) & set(need) else 1 if x["hits"] else 2))
    sites.append({"host": v["host"], "name": v["name"], "town": v["town"], "url": url, "need": need, "hasPhoto": v["hasPhoto"], "imgs": imgs[:7]})
sites.sort(key=lambda s: s["host"])
json.dump(sites, open(os.path.join(D, "sites.json"), "w"))

C, cw, ch, per = 7, 176, 132, 9
n = 0
for s0 in range(0, len(sites), per):
    part = sites[s0:s0 + per]
    sh = Image.new("RGB", (C * cw, len(part) * (ch + 18)), "#161616")
    dr = ImageDraw.Draw(sh)
    for r, x in enumerate(part):
        y = r * (ch + 18)
        dr.text((3, y + 2), f"S{s0 + r} {x['name'][:30]} | needs: {', '.join(x['need']) or '-'} | {'HAS main photo' if x['hasPhoto'] else 'no main photo'}", fill="#ffe066")
        for i, im in enumerate(x["imgs"]):
            t = Image.open(im["f"])
            t.thumbnail((cw - 4, ch - 4))
            px, py = i * cw + 2, y + 18
            sh.paste(t, (px, py))
            lab = str(i) + (" " + ",".join(im["hits"][:2]) if im["hits"] else "")
            dr.rectangle((px, py, px + 10 + 7 * len(lab), py + 12), fill="#b00020" if im["hits"] else "black")
            dr.text((px + 2, py), lab, fill="white")
    sh.save(os.path.join(D, f"sheet-{n}.png"))
    n += 1
print(len(sites), "restaurants with photos,", n, "sheets")
