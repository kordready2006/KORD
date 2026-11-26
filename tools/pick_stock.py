"""Copy the reviewed photo picks into stock/ and record their licence details.

  python3 tools/pick_stock.py <candidate dir made by fetch_stock.py>

Every pick was looked at by eye: it has to show the food clearly, with no brand names, storefronts or faces.
Each entry is "food key": ["candidate key:index", ...]. The licence, author and source page of every photo
go into data/stock_photos.json, which the app's Sources and credits screen reads.
"""
import json
import os
import sys

from PIL import Image

PICKS = {
    "pizza": ["pizza:0", "pizza:4", "pizza:6"],
    "burger": ["burger:4", "burger:3", "burger:7"],
    "wings": ["wings:1", "wings:4", "wings:7"],
    "taco": ["taco:1", "taco:7", "taco:6"],
    "burrito": ["burrito:0", "burrito:7", "burrito:5"],
    "sandwich": ["sandwich:4", "sandwich:6", "sandwich:7"],
    "hotsandwich": ["hotsandwich:5", "hotsandwich:3", "hotsandwich:4"],
    "cheesesteak": ["cheesesteak:3", "cheesesteak:2", "cheesesteak:4"],
    "gyro": ["gyro:5", "gyro:4", "gyro:0"],
    "shawarma": ["shawarma:0", "shawarma:7"],
    "chilidog": ["chilidog:3", "chilidog:7", "chilidog:6"],
    "tenders": ["tenders:2", "tenders:4", "tenders:0"],
    "chicken": ["chicken:6", "chicken:3", "chicken:5"],
    "fish": ["fish:3", "fish:4", "fish:6"],
    "sushi": ["sushi:2", "sushi:5", "sushi:7"],
    "steak": ["steak:2", "steak:3", "steak:1"],
    "bbq": ["bbq:1", "bbq:4"],
    "pasta": ["pasta:1", "pasta:4", "pasta:7"],
    "mac": ["mac:5", "mac:4", "mac:7"],
    "mexplate": ["mexplate:7", "mexplate:5", "mexplate:2"],
    "quesadilla": ["quesadilla:1", "quesadilla:2", "quesadilla:3"],
    "bowl": ["bowl:6", "bowl:5", "bowl:3"],
    "noodles": ["noodles:3", "noodles:0", "noodles:1"],
    "curry": ["curry:1", "curry:4", "curry:3"],
    "eggs": ["eggs:2", "eggs:3", "eggs:5"],
    "bagel": ["bagel:3", "bagel:5"],
    "sweet": ["sweet:0", "sweet:4", "sweet:2"],
    "cookie": ["cookie:2", "cookie:3", "cookie:5"],
    "icecream": ["icecream:2", "icecream:5", "icecream2:4", "icecream2:5"],
    "donut": ["donut:4", "donut:7", "donut:6"],
    "drink": ["drink:1", "drink:3", "drink:4"],
    "boba": ["boba:4"],
    "smoothie": ["smoothie:0", "smoothie:2"],
    "sides": ["sides:1", "sides:6", "sides:5"],
    "pretzel": ["pretzel:5", "pretzel:3", "pretzel:1"],
    "dips": ["dips:2", "dips:6", "dips:3"],
    "apps": ["apps:6", "apps:4", "apps:5"],
    "calzone": ["calzone:1", "calzone:7", "calzone:0"],
    "stromboli": ["stromboli:0", "stromboli:1"],
    "hotdog": ["hotdog:6", "hotdog:5", "hotdog:2"],
    "cupcake": ["cupcake:1", "cupcake:7", "cupcake:5"],
    "salad": ["salad3:5", "salad3:4", "salad3:1"],
    "soup": ["soup3:1", "soup3:7", "soup:4"],
    "breakfast": ["breakfast2:0", "breakfast2:1", "waffle:5"],
    "plate": ["plate3:0", "plate3:4"],
    "beer": ["beer2:2", "beer2:3"],
    "wrap": ["wrap:1", "wrap:4"],
}


def main():
    src = sys.argv[1]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cands = json.load(open(os.path.join(src, "cands.json")))
    out_dir = os.path.join(root, "stock")
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        os.remove(os.path.join(out_dir, f))
    lib, used = {}, set()
    for key, picks in PICKS.items():
        for n, pick in enumerate(picks, 1):
            ckey, i = pick.split(":")
            c = cands[ckey][int(i)]
            assert c["page"] not in used, "same photo picked twice: " + pick
            used.add(c["page"])
            im = Image.open(os.path.join(src, f"{ckey}_{i}.jpg")).convert("RGB")
            im.thumbnail((800, 800))
            name = f"{key}-{n}.jpg"
            im.save(os.path.join(out_dir, name), quality=80, optimize=True, progressive=True)
            artist = c["artist"].strip()
            if not artist or artist.startswith((".mw-", "http")) or "selbst" in artist or len(artist) > 60:
                artist = "See source page"
            lib[name] = {"key": key, "title": c["title"], "artist": artist, "license": c["license"],
                         "licenseUrl": c["licenseUrl"], "page": c["page"]}
    json.dump(lib, open(os.path.join(root, "data", "stock_photos.json"), "w"), indent=1, ensure_ascii=False)
    print(len(lib), "photos,", len(PICKS), "food types")


if __name__ == "__main__":
    main()
