#!/usr/bin/env python3
"""Data audit for the built app. Run after build.py:  python3 tools/audit.py
Prints every problem it finds and exits 1 if any are errors."""
import collections
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAYS = {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"}
d = json.load(open(os.path.join(ROOT, "data", "kord.json")))
menus = json.load(open(os.path.join(ROOT, "data", "menus.json")))
errors, warns = [], []


def price(x):
    m = re.search(r"\$\s?(\d+(?:\.\d+)?)", (x.get("price") or "").strip() or x["title"])
    return float(m.group(1)) if m else None


ids = set()
for t in d["towns"]:
    sc = t["school"]
    if not os.path.exists(os.path.join(ROOT, sc.get("logo", "missing"))):
        errors.append(f"{t['id']}: school logo file missing")
    names = collections.Counter(re.sub(r"[^a-z0-9]", "", s["name"].lower()) for s in t["spots"])
    for n, c in names.items():
        if c > 1:
            warns.append(f"{t['id']}: place listed {c} times: {n}")
    if sum(1 for s in t["spots"] if s["local"]) < 8:
        warns.append(f"{t['id']}: only {sum(1 for s in t['spots'] if s['local'])} local places")
    for day in sorted(DAYS):
        if not any(s["local"] and day in x["days"] for s in t["spots"] for x in s["deals"]):
            warns.append(f"{t['id']}: no local deal on {day}")
    for s in t["spots"]:
        if s["id"] in ids:
            errors.append(f"duplicate place id {s['id']}")
        ids.add(s["id"])
        for key in ("website", "order", "sourceUrl"):
            u = s.get(key) or ""
            if u and not re.match(r"https?://[^\s]+\.[^\s]+$", u):
                errors.append(f"{s['id']}: bad {key} link {u!r}")
        for key in ("logo", "photo"):
            f = s.get(key)
            if f and not os.path.exists(os.path.join(ROOT, f)):
                errors.append(f"{s['id']}: {key} file missing: {f}")
        if not s["name"].strip() or not s["category"]:
            errors.append(f"{s['id']}: missing name or category")
        if s.get("mi") is not None and s["mi"] > 2.5:
            errors.append(f"{s['id']}: {s['mi']} miles from campus")
        seen = set()
        for x in s["deals"]:
            if not x["title"].strip():
                errors.append(f"{s['id']}: deal with no title")
            if not x["days"] or set(x["days"]) - DAYS:
                errors.append(f"{s['id']}: deal {x['title']!r} has bad days {x['days']}")
            if not re.match(r"https?://", x.get("sourceUrl") or ""):
                errors.append(f"{s['id']}: deal {x['title']!r} has no source link")
            if (price(x) or 0) > 12:
                errors.append(f"{s['id']}: deal {x['title']!r} is over the $12 budget")
            if x.get("photo") and not os.path.exists(os.path.join(ROOT, x["photo"])):
                errors.append(f"{s['id']}: deal photo missing: {x['photo']}")
            k = x["title"].lower().strip()
            if k in seen:
                warns.append(f"{s['id']}: deal listed twice: {x['title']}")
            seen.add(k)
            named = [dy for dy, w in (("Mon", "monday"), ("Tue", "tuesday"), ("Wed", "wednesday"), ("Thu", "thursday"), ("Fri", "friday"), ("Sat", "saturday"), ("Sun", "sunday")) if w in k]
            if named and not set(named) & set(x["days"]):
                errors.append(f"{s['id']}: deal {x['title']!r} names {named} but runs {x['days']}")

for sid, items in menus.items():
    if sid not in ids:
        errors.append(f"menu for unknown place {sid}")
    junk = [i["n"] for i in items if len(i["n"]) < 3 or len(i["n"]) > 70 or re.search(r"https?://|@|\d{3}-\d{4}", i["n"])]
    if junk:
        warns.append(f"{sid}: odd menu rows: {junk[:3]}")
    if len(items) < 4:
        warns.append(f"{sid}: menu has only {len(items)} dishes")

spots = [s for t in d["towns"] for s in t["spots"]]
print(f"{len(d['towns'])} schools, {len(spots)} places, {sum(len(s['deals']) for s in spots)} deals, {len(menus)} menus")
print(f"{len(errors)} errors, {len(warns)} warnings")
for e in errors:
    print("ERROR", e)
for w in warns:
    print("warn ", w)
sys.exit(1 if errors else 0)
