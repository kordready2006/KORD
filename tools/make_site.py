#!/usr/bin/env python3
"""Assemble the folder that gets published: python3 tools/make_site.py [_site]
Copies the app and only the images the built data actually uses. A restaurant's own logo or photo is copied
only if data/rights.json allowed it, because build.py only references those files when it did."""
import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, sys.argv[1] if len(sys.argv) > 1 else "_site")
d = json.load(open(os.path.join(ROOT, "data", "kord.json")))
files = {"index.html", "app.js", "version.json", "sw.js", "manifest.webmanifest", "privacy.html", "terms.html", "rules.html", "data/kord.json", "data/menus.json"}
files |= {"icons/" + f for f in os.listdir(os.path.join(ROOT, "icons"))}
for paths in d.get("stock", {}).values():
    files |= set(paths)
for t in d["towns"]:
    if t["school"].get("logo"):
        files.add(t["school"]["logo"])
    for s in t["spots"]:
        files |= {s[k] for k in ("logo", "photo") if s.get(k)}
        files |= {x["photo"] for x in s["deals"] if x.get("photo")}
assert os.path.basename(OUT) == "_site" and os.path.dirname(OUT) == ROOT, "the site folder must be <repo>/_site"
shutil.rmtree(OUT, ignore_errors=True)
size = 0
for f in sorted(files):
    src, dst = os.path.join(ROOT, f), os.path.join(OUT, f)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(src, dst)
    size += os.path.getsize(src)
print(len(files), "files,", round(size / 1e6, 1), "MB in", OUT)
