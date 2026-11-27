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
