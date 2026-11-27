# KORD shared server

Combines every student's dish ratings and comments, and counts taps on Order / Website buttons.
It runs on a free Supabase project. The app works without it (ratings and comments then stay on each phone).

## Turn it on

1. Create a free project at https://supabase.com (any name, any password, region East US).
2. In the project, open **SQL Editor**, paste all of `server/schema.sql`, and press **Run**.
3. Open **Project Settings > API** and copy the **Project URL** and the **anon public** key.
4. Put them in `data/server.json`:

   ```json
   { "url": "https://YOUR-PROJECT.supabase.co", "key": "YOUR-ANON-PUBLIC-KEY" }
   ```

5. Run `python3 build.py` and push. The build prints `shared server ON`.

The anon key is meant to be public. It can only read the two summary views and call the three functions in
`schema.sql`; it cannot read or change the tables.

## Looking after it

- **Take a comment down:** Table Editor > `comments` > set `hidden` to true on that row.
- **See what KORD sends restaurants:** Table Editor > `order_clicks`, or
  `select place_id, count(*) from order_clicks group by 1 order by 2 desc;`
- **Limits built in:** one rating per phone per dish, comments up to 280 characters, six comments per phone
  every ten minutes.

## Testing without Supabase

`node server/mock.js 8799` is an in-memory stand-in. `node tools/test_app.js <dir>` runs two phones against it.
`schema.sql` itself has not been run against a real Postgres yet; the first real run is step 2 above.

## Student photos

Run `server/photos.sql` once in the SQL Editor after `schema.sql`. It adds the `photos` table, the `dish-photos` storage bucket
(JPEG only, 1.5 MB limit) and the functions the app calls. Until it has been run, the app hides the "Add a photo" button.
To take a photo down, set `hidden` to true on its row in the `photos` table.

Then run `server/photos2.sql`. It adds quality controls: a student photo shows on its dish at once, but only becomes the cover
picture of a deal or restaurant when you set `featured` to true on its row in `photos`, or two phones tap "Looks right" on it.
Until it has been run, photos still upload and show on dishes, but none can become a cover picture.

## Accounts

Run `server/accounts.sql` after the photo scripts. Rating, commenting, photos, "Looks right" and reporting then need a signed-in
account, and the 12-hour rating limit (20 new ratings, the `vote_cap` row in the `settings` table) is enforced in the database.

In Supabase, open Authentication > URL Configuration and set both Site URL and a Redirect URL to the app's address, so the links
in verification and password-reset emails open the app. Supabase's built-in email sender only sends a few emails an hour; add your
own SMTP provider under Authentication > Emails before launch.

To make an account an admin (after it has signed up):

    update profiles set is_admin = true where id = (select id from auth.users where email = 'you@example.com');

`tools/demo_votes.py` used the old device-based functions and no longer works once `accounts.sql` has been run.

## Stage 2: standings, perks, merch, admin

Run `server/stage2.sql` after `accounts.sql`. It adds feature switches, the restaurant standings view (KORD Index = sum of a
restaurant's ratings = average x votes), de-duplicated restaurant view counts, perks that unlock by rating count and redeem once,
the merch table, and the admin functions behind the in-app dashboard. Every admin function checks `is_admin()` in the database
and writes to `admin_log`.
