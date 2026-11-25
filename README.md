# KORD

The best food deals in Ohio college towns, day by day. Pick a town, pick a day, see the sourced deals, browse every food spot, rate the places you have eaten at.

## Run it

```
python3 build.py            # merges data/regions/*.json + data/chains.json into data/kord.json and writes index.html
python3 -m http.server 8000 # then open http://localhost:8000
```

The app is a static, installable web app (PWA): host the repo root on any static host (GitHub Pages, Netlify, Vercel), open the URL on a phone and choose "Add to Home Screen".

## Layout

- `app/kord.html` – the whole app (markup, styles, script). Edit this, then run `build.py`.
- `data/regions/*.json` – researched towns, spots and deals, one file per Ohio region. Format in `data/README.md`.
- `data/chains.json` – national chains and their standing offers; merged onto chain locations at build time.
- `index.html`, `data/kord.json` – build output.

## Not built yet

- Accounts and rankings shared between students. Profiles, photos and ratings are stored on the device only; shared rankings need a backend (for example Supabase or Firebase).
- App Store packaging. Wrap the web app with Capacitor, or rebuild in React Native, and submit through an Apple Developer account.
- Logos are loaded from each business's website icon at runtime; get permission or use owner-submitted logos before a store release.
