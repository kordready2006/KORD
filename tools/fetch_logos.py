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


UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}


def fetch(url, timeout=12):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout)


def site_icon(d, path):
    """Read the site's home page and save its apple-touch-icon or largest declared icon (48px or more)."""
    try:
        r = fetch("https://" + d)
        base, html = r.geturl(), r.read(1_500_000).decode("utf-8", "ignore")
    except Exception:
        return False
    links = re.findall(r"<link[^>]+>", html, re.I)
    cands = []
    for tag in links:
        rel = re.search(r'rel=["\']([^"\']+)', tag, re.I)
        href = re.search(r'href=["\']([^"\']+)', tag, re.I)
        if rel and href and "icon" in rel.group(1).lower():
            size = re.search(r'sizes=["\'](\d+)', tag, re.I)
            cands.append((("apple" in rel.group(1).lower()) * 1000 + (int(size.group(1)) if size else 0), href.group(1)))
    urls = [u for _, u in sorted(cands, reverse=True)] + ["/apple-touch-icon.png"]
    for u in urls[:5]:
        try:
            im = Image.open(io.BytesIO(fetch(urllib.parse.urljoin(base, u.replace("&amp;", "&"))).read())).convert("RGBA")
            if min(im.size) >= 48:
                im.thumbnail((180, 180), Image.LANCZOS)
                im.save(path, optimize=True)
                return True
        except Exception:
            continue
    return False


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
        except Exception as e:
            if site_icon(d, path):  # fall back to the icon the site itself declares
                got += 1
            else:  # remember misses so reruns are quick
                open(path + ".none", "w").write(str(e))
    print(f"{got} logos for {len(domains)} domains", file=sys.stderr)


if __name__ == "__main__":
    main()
