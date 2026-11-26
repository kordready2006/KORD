#!/usr/bin/env python3
"""Find place websites whose domain no longer exists. Writes data/dead_sites.json, which build.py uses to
hide those links.  python3 tools/check_links.py"""
import concurrent.futures as cf
import json
import os
import subprocess
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(ROOT, "data", "kord.json")))
hosts = sorted({urllib.parse.urlparse(s[k]).hostname for t in d["towns"] for s in t["spots"] for k in ("website", "order") if s.get(k)} - {None})


def dead(h):
    """True when two fetches in a row get no HTTP answer at all. A 403 or 404 still means the site exists."""
    for _ in range(2):
        r = subprocess.run(["curl", "-s", "-o", os.devnull, "-m", "20", "-A", "Mozilla/5.0", "-w", "%{http_code}", "https://" + h],
                           capture_output=True, text=True)
        if r.stdout.strip() not in ("", "000"):
            return False
    return True


with cf.ThreadPoolExecutor(24) as ex:
    gone = sorted(h for h, isdead in zip(hosts, ex.map(dead, hosts)) if isdead)
json.dump(gone, open(os.path.join(ROOT, "data", "dead_sites.json"), "w"), indent=1)
print(len(hosts), "domains checked,", len(gone), "no longer exist:", ", ".join(gone))
