# Where everything in KORD comes from

## Deals and places

- Files: `data/regions/*.json` (local places and deals) and `data/chains.json` (national chains).
- Every place has a `sourceUrl`; every deal has its own `sourceUrl` and, where the page showed one, a `sourceDate`.
- Sources are the restaurants' own websites and specials pages, college student-discount pages, local visitor and
  downtown-association listings, and student newspapers.
- How they were gathered: by web search and by reading the pages, November 25-26, 2026. Early passes could only read
  search-result summaries; later passes read the live pages. Deals from older or undated pages say so in their text.
- The build leaves out any deal priced above $12 and any place more than 2.5 miles from the centre of campus.

## Menus

- Files: `data/menus/<town>.json`. Each restaurant entry has a `source` URL: that restaurant's own menu page, PDF or
  ordering page. Dish names and prices are copied as shown there.

## Photos

- `stock/` is the photo library the app uses. Every file is listed in `data/stock_photos.json` with its title,
  author, licence, licence URL and Wikimedia Commons page. Only public domain, CC0 and CC BY works are used.
  The same list is shown in the app under You > Sources and credits. Photos are resized and cropped.
- `photos/` and `logos/` hold images taken from restaurants' and schools' own websites. They belong to those
  businesses. The app does not use or publish them unless `data/rights.json` records permission.
  `data/place_photos.json` and `data/deal_photos.json` record the page each one came from.

## Distances

- `data/geo.json`: latitude and longitude for each address, from the U.S. Census Bureau Geocoder
  (https://geocoding.geo.census.gov) and, for addresses it missed, OpenStreetMap Nominatim.
  Map data © OpenStreetMap contributors, Open Database License.
- Campus centre points are in `CAMPUS` in `build.py`.

## Fonts

- Bricolage Grotesque and DM Sans, loaded from Google Fonts, SIL Open Font License 1.1.

## Names and trademarks

- Restaurant, chain and school names are shown to identify them. KORD is not affiliated with any of them.
