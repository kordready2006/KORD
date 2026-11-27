-- KORD accounts. Run once in the Supabase SQL Editor, after schema.sql, photos.sql and photos2.sql. Safe to run more than once.
--
-- What changes: rating, commenting, adding photos, "Looks right" and reporting now need a signed-in account.
-- The rows keep living in the same tables; the old "device" column now holds the account id.
-- A 12-hour voting limit is enforced here in the database, not in the app.

-- ---------- settings the owner can change in the Table Editor ----------
create table if not exists settings (key text primary key, value jsonb not null);
alter table settings enable row level security;
insert into settings (key, value) values ('vote_cap', '20') on conflict (key) do nothing;   -- new ratings allowed per 12 hours

create or replace function vote_cap() returns int language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from settings where key = 'vote_cap'), 20);
$$;

-- ---------- profiles: one row per account ----------
create table if not exists profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text not null check (username ~ '^[A-Za-z0-9_ .-]{2,30}$'),
  town       text,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username on profiles (lower(username));
alter table profiles enable row level security;
drop policy if exists "profiles are readable" on profiles;
create policy "profiles are readable" on profiles for select using (true);
-- Only these columns are readable from phones; is_admin is not. Nothing is writable directly.
revoke all on profiles from anon, authenticated;
grant select (id, username, town, created_at) on profiles to anon, authenticated;

-- Every new account gets a profile. The username comes from the sign-up form.
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v text := btrim(left(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', ''), '[^A-Za-z0-9_ .-]', '', 'g'), 30));
begin
  if length(v) < 2 then v := 'Student ' || substr(new.id::text, 1, 6); end if;
  begin
    insert into profiles (id, username) values (new.id, v);
  exception when unique_violation then
    insert into profiles (id, username) values (new.id, left(v, 22) || ' ' || substr(new.id::text, 1, 6));
  end;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

create or replace function is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

create or replace function username_taken(p_username text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where lower(username) = lower(btrim(p_username)));
$$;

create or replace function my_profile() returns json language sql stable security definer set search_path = public as $$
  select json_build_object('username', username, 'town', town, 'is_admin', is_admin) from profiles where id = auth.uid();
$$;

create or replace function set_profile(p_username text, p_town text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in'; end if;
  if btrim(p_username) !~ '^[A-Za-z0-9_ .-]{2,30}$' or length(coalesce(p_town, '')) > 40 then raise exception 'bad input'; end if;
  if exists (select 1 from profiles where lower(username) = lower(btrim(p_username)) and id <> uid) then raise exception 'name taken'; end if;
  update profiles set username = btrim(p_username), town = nullif(p_town, '') where id = uid;
end $$;

-- ---------- ratings: one per account per dish, with a 12-hour limit on new ones ----------
alter table ratings add column if not exists created_at timestamptz not null default now();

create table if not exists vote_log (
  id         bigint generated always as identity primary key,
  user_id    uuid        not null,
  created_at timestamptz not null default now()
);
create index if not exists vote_log_user on vote_log (user_id, created_at desc);
alter table vote_log enable row level security;

-- The old functions took a device id from the phone. They are replaced by ones that use the signed-in account.
drop function if exists rate_dish(uuid, text, text, text, int);
drop function if exists add_comment(uuid, text, text, text, text, text);
drop function if exists add_photo(uuid, text, text, text, text);
drop function if exists report_comment(uuid, bigint);
drop function if exists report_photo(uuid, bigint);
drop function if exists like_photo(uuid, bigint);

-- stars = 0 removes the rating. Changing a rating you already gave is free; a new one uses one of your votes.
create or replace function rate_dish(p_town text, p_place text, p_dish text, p_stars int)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in'; end if;
  if length(p_town) > 40 or length(p_place) > 120 or length(p_dish) not between 1 and 80 then raise exception 'bad input'; end if;
  if p_stars = 0 then
    delete from ratings where device = uid and place_id = p_place and dish = p_dish;
    return;
  end if;
  if p_stars not between 1 and 10 then raise exception 'bad stars'; end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));   -- two taps at once cannot both slip under the limit
  if not exists (select 1 from ratings where device = uid and place_id = p_place and dish = p_dish) then
    if (select count(*) from vote_log where user_id = uid and created_at > now() - interval '12 hours') >= vote_cap() then
      raise exception 'vote limit';
    end if;
    insert into vote_log (user_id) values (uid);
  end if;
  insert into ratings (device, town, place_id, dish, stars) values (uid, p_town, p_place, p_dish, p_stars)
  on conflict (device, place_id, dish) do update set stars = excluded.stars, updated_at = now();
end $$;

create or replace function my_votes() returns json language sql stable security definer set search_path = public as $$
  with w as (select created_at from vote_log where user_id = auth.uid() and created_at > now() - interval '12 hours')
  select json_build_object(
    'used', (select count(*) from w),
    'cap', vote_cap(),
    'remaining', greatest(0, vote_cap() - (select count(*) from w)),
    'next_at', (select min(created_at) + interval '12 hours' from w),
    'highest', (select max(stars) from ratings where device = auth.uid()),
    'rated', (select count(*) from ratings where device = auth.uid()));
$$;

create or replace function my_ratings() returns table (place_id text, dish text, stars smallint)
language sql stable security definer set search_path = public as $$
  select place_id, dish, stars from ratings where device = auth.uid();
$$;

-- ---------- comments ----------
create or replace function add_comment(p_town text, p_place text, p_dish text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_body text := btrim(p_body); v_name text;
begin
  if uid is null then raise exception 'sign in'; end if;
  if length(v_body) not between 1 and 280 or length(p_town) > 40 or length(p_place) > 120 or length(p_dish) not between 1 and 80 then
    raise exception 'bad input';
  end if;
  if (select count(*) from comments where device = uid and created_at > now() - interval '10 minutes') >= 6 then
    raise exception 'slow down';
  end if;
  select username into v_name from profiles where id = uid;
  insert into comments (device, town, place_id, dish, name, body) values (uid, p_town, p_place, p_dish, coalesce(v_name, 'Student'), v_body);
end $$;

create or replace function report_comment(p_comment bigint)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in'; end if;
  insert into comment_reports (comment_id, device) values (p_comment, uid) on conflict do nothing;
  if (select count(*) from comment_reports where comment_id = p_comment) >= 3 then
    update comments set hidden = true where id = p_comment;
  end if;
end $$;

-- ---------- photos ----------
create or replace function add_photo(p_town text, p_place text, p_dish text, p_path text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in'; end if;
  if length(p_town) > 40 or length(p_place) > 120 or length(p_dish) not between 1 and 80
     or p_path !~ ('^' || uid::text || '/[0-9a-f-]{36}\.jpg$') then
    raise exception 'bad input';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'dish-photos' and name = p_path) then raise exception 'no such file'; end if;
  if (select count(*) from photos where device = uid and created_at > now() - interval '1 day') >= 12 then raise exception 'slow down'; end if;
  insert into photos (device, town, place_id, dish, path) values (uid, p_town, p_place, p_dish, p_path);
end $$;

create or replace function report_photo(p_photo bigint)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in'; end if;
  insert into photo_reports (photo_id, device) values (p_photo, uid) on conflict do nothing;
  if (select count(*) from photo_reports where photo_id = p_photo) >= 2 then
    update photos set hidden = true where id = p_photo;
  end if;
end $$;

create or replace function like_photo(p_photo bigint)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in'; end if;
  insert into photo_likes (photo_id, device) values (p_photo, uid) on conflict do nothing;
end $$;

create or replace function my_photo_paths() returns setof text language sql stable security definer set search_path = public as $$
  select path from photos where device = auth.uid();
$$;

-- Photo files: only a signed-in account may add files, and only inside its own folder. It may remove its own files
-- (used when an account is deleted). Everyone can still view them through the public link.
drop policy if exists "students can add dish photos" on storage.objects;
drop policy if exists "accounts add their own dish photos" on storage.objects;
create policy "accounts add their own dish photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'dish-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "accounts see their own dish photos" on storage.objects;
create policy "accounts see their own dish photos" on storage.objects
  for select to authenticated using (bucket_id = 'dish-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "accounts remove their own dish photos" on storage.objects;
create policy "accounts remove their own dish photos" on storage.objects
  for delete to authenticated using (bucket_id = 'dish-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- deleting an account ----------
-- Removes the account's ratings, comments, photos, reports, likes and login. The app deletes the photo files first.
-- The last admin cannot delete their account: make someone else an admin first.
create or replace function delete_account()
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in'; end if;
  if (select is_admin from profiles where id = uid) and (select count(*) from profiles where is_admin) <= 1 then
    raise exception 'last admin';
  end if;
  delete from ratings where device = uid;
  delete from comments where device = uid;
  delete from comment_reports where device = uid;
  delete from photo_reports where device = uid;
  delete from photo_likes where device = uid;
  delete from photos where device = uid;
  delete from vote_log where user_id = uid;
  delete from auth.users where id = uid;     -- the profile row goes with it
end $$;

-- ---------- who may call what ----------
revoke execute on function rate_dish(text, text, text, int), add_comment(text, text, text, text), add_photo(text, text, text, text),
  report_comment(bigint), report_photo(bigint), like_photo(bigint), my_votes(), my_ratings(), my_profile(), set_profile(text, text),
  my_photo_paths(), delete_account() from public, anon;
grant execute on function rate_dish(text, text, text, int), add_comment(text, text, text, text), add_photo(text, text, text, text),
  report_comment(bigint), report_photo(bigint), like_photo(bigint), my_votes(), my_ratings(), my_profile(), set_profile(text, text),
  my_photo_paths(), delete_account() to authenticated;
grant execute on function username_taken(text), vote_cap(), is_admin() to anon, authenticated;
