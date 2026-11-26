#!/usr/bin/env python3
"""Find freely licensed food photos on Wikimedia Commons, as candidates for KORD's photo library.
  python3 tools/fetch_stock.py <out-dir> [key ...]
Only keeps images whose licence is public domain / CC0 or Creative Commons Attribution (CC BY), which allow
commercial use in an app. Share-alike, non-commercial and no-derivatives licences are skipped.
Writes <out-dir>/cands.json and the candidate image files. A person then picks from them (tools/pick_stock.py)."""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) KORD-app-build/1.0 (college food deals app; photo library)"
QUERIES = {
    "pizza": "pepperoni pizza", "burger": "cheeseburger", "wings": "buffalo wings", "taco": "tacos", "burrito": "burrito",
    "sandwich": "submarine sandwich", "hotsandwich": "roast beef sandwich", "cheesesteak": "cheesesteak sandwich", "gyro": "gyro sandwich",
    "shawarma": "shawarma wrap", "chilidog": "chili dog", "tenders": "chicken tenders", "chicken": "fried chicken plate",
    "fish": "fish and chips", "sushi": "sushi rolls", "steak": "grilled steak plate", "bbq": "barbecue ribs", "pasta": "spaghetti",
    "mac": "macaroni and cheese", "mexplate": "nachos", "quesadilla": "quesadilla", "bowl": "rice bowl food", "salad": "salad bowl",
    "soup": "bowl of soup", "noodles": "ramen bowl", "curry": "chicken curry rice", "breakfast": "pancakes breakfast", "eggs": "breakfast eggs bacon",
    "bagel": "bagel sandwich", "sweet": "chocolate cake slice", "cookie": "chocolate chip cookies", "icecream": "ice cream cone",
    "donut": "glazed doughnuts", "drink": "latte coffee cup", "boba": "bubble tea", "smoothie": "fruit smoothie glass", "sides": "french fries",
    "pretzel": "soft pretzel", "dips": "guacamole chips", "apps": "mozzarella sticks", "calzone": "calzone", "stromboli": "stromboli food",
    "plate": "diner plate lunch", "hotdog": "hot dog", "cupcake": "cupcakes",
    "salad2": "garden salad plate", "soup2": "tomato soup bowl", "breakfast2": "stack of pancakes syrup", "boba2": "boba milk tea cup", "plate2": "meatloaf mashed potatoes plate",
    "beer": "pint of beer glass bar", "icecream2": "ice cream sundae", "waffle": "waffles breakfast plate", "wrap": "chicken wrap sandwich",
    "boba3": "bubble tea", "plate3": "meatloaf", "beer2": "glass of beer", "soup3": "chicken noodle soup", "salad3": "caesar salad", "plate4": "comfort food dinner plate",
}
OK = re.compile(r"^(CC0|Public domain|PD|CC BY [0-9.]+)\b(?!-)", re.I)


def get(url, tries=4):
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=40).read()
        except Exception:
            time.sleep(5 + 8 * i)
    return None


def text(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()


def file_info(name, group):
    """Read one Commons file page: licence, author and the image address.
    `group` is the search filter the file came from: "unrestricted" (public domain / CC0) or "attribution" (CC BY)."""
    raw = get("https://commons.wikimedia.org/wiki/" + name)
    time.sleep(0.6)
    if not raw:
        return None
    h = raw.decode("utf-8", "ignore")
    # Only the licence box counts: every Commons page also links CC BY-SA in its footer (for the page text).
    box = " ".join(h[m.start():m.start() + 4000] for m in re.finditer(r'class="[^"]*licensetpl', h))
    if not box or re.search(r"creativecommons\.org/licenses/by-(sa|nc|nd)", box) or re.search(r"GNU Free Documentation", box):
        return None
    by = re.search(r"creativecommons\.org/licenses/by/([0-9.]+)", box)
    if group == "attribution":
        if not by:
            return None
        lic, lic_url = "CC BY " + by.group(1), "https://creativecommons.org/licenses/by/" + by.group(1) + "/"
    elif by:
        return None
    elif "CC0 1.0 Universal" in box or "publicdomain/zero" in box:
        lic, lic_url = "CC0 1.0", "https://creativecommons.org/publicdomain/zero/1.0/"
    else:
        lic, lic_url = "Public domain", "https://creativecommons.org/publicdomain/mark/1.0/"
    m = re.search(r'<div class="fullImageLink"[^>]*><a href="(https://upload\.wikimedia\.org/wikipedia/commons/(\w/\w\w)/([^"?]+))', h)
    dims = re.search(r"Original file</a>[^(]*\(([\d,]+) × ([\d,]+) pixels", h) or re.search(r"([\d,]+) × ([\d,]+) pixels, file size", h)
    if not m or not dims or not m.group(3).lower().endswith((".jpg", ".jpeg")):
        return None
    w, hh = int(dims.group(1).replace(",", "")), int(dims.group(2).replace(",", ""))
    if w < 800 or w < hh * 1.15:
        return None
    a = re.search(r'id="fileinfotpl_aut".*?</td>\s*<td[^>]*>(.*?)</td>', h, re.S) or re.search(r">\s*Author\s*</t[dh]>\s*<td[^>]*>(.*?)</td>", h, re.S)
    artist = text(a.group(1))[:90] if a else ""
    if not artist:
        if group == "attribution":
            return None  # CC BY needs a name to credit
        artist = "Unknown author"
    return {"title": urllib.parse.unquote(name.replace("File:", "")).rsplit(".", 1)[0].replace("_", " "), "artist": artist, "license": lic, "licenseUrl": lic_url,
            "page": "https://commons.wikimedia.org/wiki/" + name, "path": m.group(2), "file": m.group(3)}


def main():
    out = sys.argv[1]
    keys = sys.argv[2:] or list(QUERIES)
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, "cands.json")
    cands = json.load(open(path)) if os.path.exists(path) else {}
    for key in keys:
        if key in cands:
            continue
        found, seen = [], set()
        for group in ("unrestricted", "attribution"):
            raw = get("https://commons.wikimedia.org/w/index.php?ns6=1&limit=40&search=" + urllib.parse.quote(QUERIES[key] + " filetype:bitmap haslicense:" + group))
            time.sleep(1.5)
            tried = 0
            names = re.findall(r'href="/wiki/(File:[^"]+)"', raw.decode("utf-8", "ignore")) if raw else []
            for name in names:
                if name in seen or not name.lower().endswith((".jpg", ".jpeg")):
                    continue
                seen.add(name)
                info = file_info(name, group)
                if info:
                    info["group"] = group
                    found.append(info)
                got = sum(1 for c in found if c["group"] == group)
                tried += 1
                if got >= 5 or tried >= 22:
                    break
        for i, c in enumerate(found):
            f = os.path.join(out, f"{key}_{i}.jpg")
            if not os.path.exists(f):
                b = get(f"https://upload.wikimedia.org/wikipedia/commons/thumb/{c['path']}/{c['file']}/960px-{c['file']}")
                time.sleep(3)  # the image server throttles bursts
                if b:
                    open(f, "wb").write(b)
        cands[key] = found
        json.dump(cands, open(path, "w"), indent=1)
        print(key, len(found), flush=True)


if __name__ == "__main__":
    main()
