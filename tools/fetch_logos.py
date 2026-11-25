#!/usr/bin/env python3
"""Download a site icon for every food spot that has a website, into logos/spots/<domain>.png.

Run after research updates, before build.py:  python3 tools/fetch_logos.py
Icons smaller than 32px are skipped; those spots keep their colored initials.
"""
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "logos", "spots")
SKIP = re.compile(r"(^|\.)(facebook|instagram|x|twitter|linktr|toasttab|google|yelp|tripadvisor|doordash|grubhub|ubereats|square|wixsite|wordpress|business|spoton|toast)\.")


def domain(url):
    try:
        return urllib.parse.urlparse(url).hostname.removeprefix("www.")
    except Exception:
        return ""


def main():
    data = json.load(open(os.path.join(ROOT, "data", "kord.json")))
    domains = sorted({domain(s["website"]) for t in data["towns"] for s in t["spots"] if s.get("website")} - {""})
    got = 0
    for d in domains:
        path = os.path.join(OUT, d + ".png")
        if SKIP.search(d + ".") or os.path.exists(path) or os.path.exists(path + ".none"):
            got += os.path.exists(path)
            continue
        try:
            raw = urllib.request.urlopen("https://www.google.com/s2/favicons?sz=128&domain=" + urllib.parse.quote(d), timeout=20).read()
            im = Image.open(io.BytesIO(raw)).convert("RGBA")
            if min(im.size) < 32:
                raise ValueError("too small")
            im.thumbnail((128, 128), Image.LANCZOS)
            im.save(path, optimize=True)
            got += 1
        except Exception as e:  # remember misses so reruns are quick
            open(path + ".none", "w").write(str(e))
    print(f"{got} logos for {len(domains)} domains", file=sys.stderr)


if __name__ == "__main__":
    main()
