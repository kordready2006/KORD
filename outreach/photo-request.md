# Photo request email

Send from kordready2006@gmail.com. The contact list is `outreach/contacts.csv` (restaurant, school, email, deals we list).
In Gmail you can send these one at a time, or use a mail-merge add-on with the CSV so each restaurant gets its own name and deals filled in.

---

**Subject:** Free listing for {{restaurant}} on KORD, the student deals app at {{school}}

Hi {{restaurant}} team,

I'm a student at Ohio University building KORD, a free app that shows college students the best food deals near campus each day. {{restaurant}} is already listed for {{school}} students, with these deals:

{{deals}}

I'd like your listing to show your real food. Could you reply with:

1. **A few photos of your food**, especially the items in the deals above. Phone photos are fine.
2. **Your logo**, if you have a file handy.
3. **Any corrections** to the deals, or new specials you'd like students to see.

By replying with photos you're giving KORD permission to show them on your listing. I'll take anything down whenever you ask.

There's no cost. You can see the app here: https://kordready2006.github.io/KORD/

Thanks,
{{your name}}
KORD
kordready2006@gmail.com

---

## When photos come back

Save them as `photos/<restaurant-website-domain>--<dish>.jpg` for a specific dish (for example `photos/broneys.net--wings.jpg`)
or `photos/<restaurant-website-domain>.jpg` for the restaurant's main photo, then run `python3 build.py` and push.
Dish names the app understands are listed in `DISHES` in `build.py` (wings, taco, burger, pizza, sandwich, pasta, steak, bowl, ...).
