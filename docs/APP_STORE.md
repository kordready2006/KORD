# Getting KORD onto the App Store

KORD is a web app. Apple only accepts native apps, so the web app is wrapped with Capacitor.
None of the steps below have been run yet: they need a Mac with Xcode, which the build environment does not have.

## What you need

- A Mac with Xcode installed.
- An Apple Developer account ($99 a year): https://developer.apple.com/programs/
- Node.js 20 or newer.

## Steps

```
python3 build.py                 # build the data and app
python3 tools/make_site.py _site # collect the files that ship
npm install                      # installs Capacitor (see package.json)
npx cap add ios                  # creates the Xcode project in ios/
npx cap sync ios                 # copies _site into it
npx cap open ios                 # opens Xcode
```

In Xcode: pick your team under Signing & Capabilities, set the bundle identifier (`capacitor.config.json` uses
`app.kord.deals`; change it if that is taken), add the app icons from `icons/`, then Product > Archive and upload.

## Before you submit

Apple's review will look at these. Each one is a real blocker.

| Item | State |
| --- | --- |
| Images you have the right to use | The app currently shows each restaurant's own photos and logo and each school's logo, taken from their websites without written permission (`data/rights.json`). Apple can reject this, and owners can ask for removal. Before submitting, either collect permission (see `outreach/`) or set the three flags in `data/rights.json` to false and `stockPhotos` to true, which switches to the licensed library in `stock/`. |
| Third-party trademarks (guideline 5.2) | Same switch as above. Names are always shown as plain text with a "not affiliated" notice. |
| Street view | Needs a Google Maps Platform key with the Street View Static API enabled, restricted to the app's web address, in `data/server.json` as `streetViewKey`. Google's terms require the image to be loaded live with its attribution, not saved. |
| Privacy policy URL | `privacy.html` is a draft. Have a lawyer review it, then give Apple the public URL. |
| Terms of use | `terms.html` is a draft, same review. |
| User-generated content (guideline 1.2) | Comments need a way to report and block, and you must act on reports within 24 hours. Each comment has a Report link: it hides the comment for that person at once, and the server hides it for everyone after three reports (`server/schema.sql`). You still need to check reports and respond within 24 hours, and there is no block-a-user control yet. |
| Payments (guideline 3.1) | Ordering is a demo. Real food orders are physical goods, so they use a payment processor such as Stripe, not Apple's in-app purchase. KORD Plus, if it only removes a fee on food orders, likely follows the same rule; confirm before launch. |
| More than a website (guideline 4.2) | Apple rejects apps that are only a wrapped web page. Push notifications for the day's deal and saved favourites are the usual additions. Not built yet. |
| Accurate listings | Deals are sourced and dated, but restaurants change them. Keep the "confirm before you go" notice. |
| Age rating | Bars are listed and alcohol is mentioned. Answer the alcohol question honestly; expect 17+ or 12+ depending on wording. |

## Shared ratings server

See `server/README.md`. The app works without it, but ratings and comments then stay on each phone.
