#!/usr/bin/env python3
"""Look up latitude/longitude for every place address, cached in data/geo.json.

Uses the free US Census batch geocoder, then OpenStreetMap's Nominatim for addresses the Census misses.
Run after research updates, before build.py:  python3 tools/geocode.py
"""
import csv
import glob
import io
import json
import os
import re
import time
import urllib.parse
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO = os.path.join(ROOT, "data", "geo.json")
UA = {"User-Agent": "KORD-app-build/1.0 (college food deals app)"}


def census(addresses):
    """addresses: list of full address strings. Returns {address: [lat, lon]} for matches."""
    rows = io.StringIO()
    w = csv.writer(rows)
    for i, a in enumerate(addresses):
        parts = [p.strip() for p in a.split(",")]
        if len(parts) < 3:
            continue
        m = re.match(r"([A-Za-z]{2})\s*(\d{5})?", parts[-1])
        w.writerow([i, parts[0], parts[-2], m.group(1) if m else "OH", (m.group(2) if m and m.group(2) else "")])
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"benchmark\"\r\n\r\nPublic_AR_Current\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"addressFile\"; filename=\"a.csv\"\r\nContent-Type: text/csv\r\n\r\n"
            f"{rows.getvalue()}\r\n--{boundary}--\r\n").encode()
    req = urllib.request.Request("https://geocoding.geo.census.gov/geocoder/locations/addressbatch", data=body,
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}", **UA})
    out = {}
    for row in csv.reader(io.StringIO(urllib.request.urlopen(req, timeout=300).read().decode("utf-8", "ignore"))):
        if len(row) >= 6 and row[2] == "Match":
            lon, lat = row[5].split(",")
            out[addresses[int(row[0])]] = [round(float(lat), 5), round(float(lon), 5)]
    return out


def nominatim(address):
    url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=" + urllib.parse.quote(address)
    try:
        r = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read())
        return [round(float(r[0]["lat"]), 5), round(float(r[0]["lon"]), 5)] if r else None
    except Exception:
        return None


def main():
    geo = json.load(open(GEO)) if os.path.exists(GEO) else {}
    addrs = set()
    for path in glob.glob(os.path.join(ROOT, "data", "regions", "*.json")):
        for t in json.load(open(path))["towns"]:
            for s in t["spots"]:
                a = (s.get("address") or "").strip()
                if a and re.match(r"\d", a) and a not in geo:
                    addrs.add(a)
    addrs = sorted(addrs)
    print(len(addrs), "addresses to look up")
    for i in range(0, len(addrs), 800):
        try:
            geo.update(census(addrs[i:i + 800]))
        except Exception as e:
            print("census batch failed:", e)
    missed = [a for a in addrs if a not in geo]
    print(len(missed), "left for OpenStreetMap")
    for a in missed:
        geo[a] = nominatim(a)  # None is cached too, so a miss is not retried every run
        time.sleep(1.1)
    json.dump(geo, open(GEO, "w"), indent=0, sort_keys=True)
    print(sum(1 for v in geo.values() if v), "of", len(geo), "addresses located")


if __name__ == "__main__":
    main()
