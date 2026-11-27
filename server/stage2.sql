-- KORD stage 2: feature switches, restaurant standings (the KORD Index), view counts, unlockable perks, merch, admin tools.
-- Run once in the Supabase SQL Editor, after accounts.sql. Safe to run more than once.

-- ---------- feature switches (admins flip these in the app; they are enforced here as well) ----------
create table if not exists feature_flags (key text primary key, label text not null, enabled boolean not null default true);
alter table feature_flags enable row level security;
drop policy if exists "flags are readable" on feature_flags;
create policy "flags are readable" on feature_flags for select using (true);
grant select on feature_flags to anon, authenticated;
insert into feature_flags (key, label) values
  ('comments', 'Comments on dishes'), ('photos', 'Student photos'), ('standings', 'Standings and leaderboards'),
  ('perks', 'Perks and deal redemptions'), ('community', 'Community feed'), ('friends', 'Friends and following')
on conflict (key) do nothing;

create or replace function flag_on(p_key text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select enabled from feature_flags where key = p_key), true);
$$;

-- comments and photos now respect their switches
create or replace function add_comment(p_town text, p_place text, p_dish text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_body text := btrim(p_body); v_name text;
begin
  if uid is null then raise exception 'sign in'; end if;
  if not flag_on('comments') then raise exception 'switched off'; end if;
  if length(v_body) not between 1 and 280 or length(p_town) > 40 or length(p_place) > 120 or length(p_dish) not between 1 and 80 then
    raise exception 'bad input';
  end if;
  if (select count(*) from comments where device = uid and created_at > now() - interval '10 minutes') >= 6 then
    raise exception 'slow down';
  end if;
  select username into v_name from profiles where id = uid;
  insert into comments (device, town, place_id, dish, name, body) values (uid, p_town, p_place, p_dish, coalesce(v_name, 'Student'), v_body);
end $$;

create or replace function add_photo(p_town text, p_place text, p_dish text, p_path text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in'; end if;
  if not flag_on('photos') then raise exception 'switched off'; end if;
  if length(p_town) > 40 or length(p_place) > 120 or length(p_dish) not between 1 and 80
     or p_path !~ ('^' || uid::text || '/[0-9a-f-]{36}\.jpg$') then
    raise exception 'bad input';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'dish-photos' and name = p_path) then raise exception 'no such file'; end if;
  if (select count(*) from photos where device = uid and created_at > now() - interval '1 day') >= 12 then raise exception 'slow down'; end if;
  insert into photos (device, town, place_id, dish, path) values (uid, p_town, p_place, p_dish, p_path);
end $$;

-- ---------- standings: the KORD Index ----------
-- KORD Index of a restaurant = the sum of every rating its dishes have received
-- (the same thing as its average rating multiplied by its number of votes). More votes and better votes both raise it.
create or replace view place_standings as
  select town, place_id, count(*)::int as votes, round(avg(stars)::numeric, 2) as avg, sum(stars)::int as idx
  from ratings group by town, place_id;
grant select on place_standings to anon, authenticated;

-- ---------- restaurant views: one per viewer per restaurant per day, however often the page is refreshed ----------
create table if not exists place_views (
  place_id text not null, town text not null, viewer uuid not null, day date not null default current_date,
  primary key (place_id, viewer, day)
);
alter table place_views enable row level security;
create or replace function log_view(p_town text, p_place text, p_viewer uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if length(p_town) <= 40 and length(p_place) <= 120 then
    insert into place_views (place_id, town, viewer) values (p_place, p_town, coalesce(auth.uid(), p_viewer)) on conflict do nothing;
  end if;
end $$;
grant execute on function log_view(text, text, uuid) to anon, authenticated;

-- ---------- perks: deals a student unlocks by rating dishes ----------
create table if not exists perks (
  id             bigint generated always as identity primary key,
  town           text,                       -- null = every school
  place_id       text,                       -- null = a KORD perk, not tied to one restaurant
  title          text not null check (length(title) between 1 and 80),
  description    text not null default '' check (length(description) <= 400),
  starts_at      timestamptz not null default now(),
  ends_at        timestamptz,
  votes_required int  not null default 0 check (votes_required between 0 and 1000),
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
alter table perks enable row level security;
drop policy if exists "live perks are readable" on perks;
create policy "live perks are readable" on perks for select using (active and starts_at <= now() and (ends_at is null or ends_at > now()));
grant select on perks to anon, authenticated;

create table if not exists perk_unlocks (
  perk_id     bigint not null references perks (id) on delete cascade,
  user_id     uuid   not null,
  unlocked_at timestamptz not null default now(),
  redeemed_at timestamptz,
  primary key (perk_id, user_id)
);
alter table perk_unlocks enable row level security;

create or replace function unlock_perk(p_perk bigint)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); pk perks;
begin
  if uid is null then raise exception 'sign in'; end if;
  if not flag_on('perks') then raise exception 'switched off'; end if;
  select * into pk from perks where id = p_perk and active and starts_at <= now() and (ends_at is null or ends_at > now());
  if not found then raise exception 'not available'; end if;
  if (select count(*) from ratings where device = uid) < pk.votes_required then raise exception 'not enough votes'; end if;
  insert into perk_unlocks (perk_id, user_id) values (p_perk, uid) on conflict do nothing;
end $$;

-- Redeeming is one-time: the row is locked and stamped, so two taps cannot both succeed.
create or replace function redeem_perk(p_perk bigint)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); t timestamptz;
begin
  if uid is null then raise exception 'sign in'; end if;
  if not flag_on('perks') then raise exception 'switched off'; end if;
  if not exists (select 1 from perks where id = p_perk and active and starts_at <= now() and (ends_at is null or ends_at > now())) then raise exception 'not available'; end if;
  update perk_unlocks set redeemed_at = now() where perk_id = p_perk and user_id = uid and redeemed_at is null returning redeemed_at into t;
  if t is null then raise exception 'not unlocked or already redeemed'; end if;
  return t;
end $$;

create or replace function my_perks() returns table (perk_id bigint, unlocked_at timestamptz, redeemed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select perk_id, unlocked_at, redeemed_at from perk_unlocks where user_id = auth.uid();
$$;

-- ---------- merch ----------
create table if not exists merch (
  id          bigint generated always as identity primary key,
  name        text not null check (length(name) between 1 and 80),
  description text not null default '' check (length(description) <= 400),
  price       text not null default '' check (length(price) <= 20),
  image_url   text not null default '' check (image_url = '' or image_url ~ '^https://'),
  link_url    text not null default '' check (link_url = '' or link_url ~ '^https://'),
  available   boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);
alter table merch enable row level security;
drop policy if exists "merch is readable" on merch;
create policy "merch is readable" on merch for select using (true);
grant select on merch to anon, authenticated;

-- ---------- admin tools: every function checks the caller is an admin, in the database ----------
create table if not exists admin_log (
  id bigint generated always as identity primary key, admin_id uuid not null, action text not null, detail jsonb, at timestamptz not null default now()
);
alter table admin_log enable row level security;

create or replace function need_admin() returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not is_admin() then raise exception 'not admin'; end if;
  return auth.uid();
end $$;

create or replace function admin_stats() returns json language plpgsql stable security definer set search_path = public as $$
begin
  perform need_admin();
  return json_build_object(
    'users', (select count(*) from profiles),
    'active_7d', (select count(distinct user_id) from vote_log where created_at > now() - interval '7 days'),
    'ratings', (select count(*) from ratings),
    'ratings_7d', (select count(*) from vote_log where created_at > now() - interval '7 days'),
    'comments', (select count(*) from comments where not hidden),
    'photos', (select count(*) from photos where not hidden),
    'views_30d', (select count(*) from place_views where day > current_date - 30),
    'order_clicks_30d', (select count(*) from order_clicks where created_at > now() - interval '30 days'),
    'perk_unlocks', (select count(*) from perk_unlocks),
    'perk_redemptions', (select count(*) from perk_unlocks where redeemed_at is not null),
    'open_reports', (select count(*) from (select comment_id from comment_reports group by comment_id) a) + (select count(*) from (select photo_id from photo_reports group by photo_id) b),
    'vote_cap', vote_cap(),
    'top_dishes', (select coalesce(json_agg(x), '[]') from (select place_id, dish, count(*)::int as votes, round(avg(stars)::numeric, 1) as avg from ratings group by place_id, dish order by count(*) desc, avg(stars) desc limit 8) x),
    'top_viewed', (select coalesce(json_agg(x), '[]') from (select place_id, count(*)::int as views from place_views where day > current_date - 30 group by place_id order by count(*) desc limit 8) x));
end $$;

create or replace function admin_set_flag(p_key text, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare a uuid := need_admin();
begin
  update feature_flags set enabled = p_enabled where key = p_key;
  insert into admin_log (admin_id, action, detail) values (a, 'set_flag', json_build_object('key', p_key, 'enabled', p_enabled)::jsonb);
end $$;

create or replace function admin_set_vote_cap(p_cap int)
returns void language plpgsql security definer set search_path = public as $$
declare a uuid := need_admin();
begin
  if p_cap not between 1 and 500 then raise exception 'bad input'; end if;
  insert into settings (key, value) values ('vote_cap', to_jsonb(p_cap)) on conflict (key) do update set value = excluded.value;
  insert into admin_log (admin_id, action, detail) values (a, 'set_vote_cap', to_jsonb(p_cap));
end $$;

create or replace function admin_perks() returns setof perks language plpgsql stable security definer set search_path = public as $$
begin perform need_admin(); return query select * from perks order by created_at desc; end $$;

-- p: {id?, town, place_id, title, description, starts_at, ends_at, votes_required, active}
create or replace function admin_save_perk(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare a uuid := need_admin(); v bigint := nullif(p ->> 'id', '')::bigint;
begin
  if v is null then
    insert into perks (town, place_id, title, description, starts_at, ends_at, votes_required, active)
    values (nullif(p ->> 'town', ''), nullif(p ->> 'place_id', ''), btrim(p ->> 'title'), coalesce(p ->> 'description', ''),
            coalesce(nullif(p ->> 'starts_at', '')::timestamptz, now()), nullif(p ->> 'ends_at', '')::timestamptz,
            coalesce(nullif(p ->> 'votes_required', '')::int, 0), coalesce((p ->> 'active')::boolean, true))
    returning id into v;
  else
    update perks set town = nullif(p ->> 'town', ''), place_id = nullif(p ->> 'place_id', ''), title = btrim(p ->> 'title'),
      description = coalesce(p ->> 'description', ''), starts_at = coalesce(nullif(p ->> 'starts_at', '')::timestamptz, starts_at),
      ends_at = nullif(p ->> 'ends_at', '')::timestamptz, votes_required = coalesce(nullif(p ->> 'votes_required', '')::int, 0),
      active = coalesce((p ->> 'active')::boolean, true) where id = v;
  end if;
  insert into admin_log (admin_id, action, detail) values (a, 'save_perk', p || jsonb_build_object('id', v));
  return v;
end $$;

create or replace function admin_delete_perk(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare a uuid := need_admin();
begin
  delete from perks where id = p_id;
  insert into admin_log (admin_id, action, detail) values (a, 'delete_perk', to_jsonb(p_id));
end $$;

-- p: {id?, name, description, price, image_url, link_url, available, sort}
create or replace function admin_save_merch(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare a uuid := need_admin(); v bigint := nullif(p ->> 'id', '')::bigint;
begin
  if v is null then
    insert into merch (name, description, price, image_url, link_url, available, sort)
    values (btrim(p ->> 'name'), coalesce(p ->> 'description', ''), coalesce(p ->> 'price', ''), coalesce(p ->> 'image_url', ''),
            coalesce(p ->> 'link_url', ''), coalesce((p ->> 'available')::boolean, true), coalesce(nullif(p ->> 'sort', '')::int, 0))
    returning id into v;
  else
    update merch set name = btrim(p ->> 'name'), description = coalesce(p ->> 'description', ''), price = coalesce(p ->> 'price', ''),
      image_url = coalesce(p ->> 'image_url', ''), link_url = coalesce(p ->> 'link_url', ''),
      available = coalesce((p ->> 'available')::boolean, true), sort = coalesce(nullif(p ->> 'sort', '')::int, 0) where id = v;
  end if;
  insert into admin_log (admin_id, action, detail) values (a, 'save_merch', p || jsonb_build_object('id', v));
  return v;
end $$;

create or replace function admin_delete_merch(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare a uuid := need_admin();
begin
  delete from merch where id = p_id;
  insert into admin_log (admin_id, action, detail) values (a, 'delete_merch', to_jsonb(p_id));
end $$;

-- Everything students have reported, most-reported first.
create or replace function admin_reports() returns json language plpgsql stable security definer set search_path = public as $$
begin
  perform need_admin();
  return json_build_object(
    'comments', (select coalesce(json_agg(x), '[]') from (
      select c.id, c.place_id, c.dish, c.name, c.body, c.hidden, c.created_at, count(r.*)::int as reports
      from comments c join comment_reports r on r.comment_id = c.id group by c.id order by count(r.*) desc, c.created_at desc limit 100) x),
    'photos', (select coalesce(json_agg(x), '[]') from (
      select p.id, p.place_id, p.dish, p.path, p.hidden, p.featured, p.created_at, count(r.*)::int as reports
      from photos p join photo_reports r on r.photo_id = p.id group by p.id order by count(r.*) desc, p.created_at desc limit 100) x));
end $$;

-- p_kind: 'comment' or 'photo'. p_action: 'hide', 'show' (also clears its reports), 'delete', 'feature', 'unfeature' (photos).
create or replace function admin_moderate(p_kind text, p_id bigint, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare a uuid := need_admin();
begin
  if p_kind = 'comment' then
    if p_action = 'hide' then update comments set hidden = true where id = p_id;
    elsif p_action = 'show' then update comments set hidden = false where id = p_id; delete from comment_reports where comment_id = p_id;
    elsif p_action = 'delete' then delete from comments where id = p_id;
    else raise exception 'bad input'; end if;
  elsif p_kind = 'photo' then
    if p_action = 'hide' then update photos set hidden = true where id = p_id;
    elsif p_action = 'show' then update photos set hidden = false where id = p_id; delete from photo_reports where photo_id = p_id;
    elsif p_action = 'delete' then delete from photos where id = p_id;
    elsif p_action = 'feature' then update photos set featured = true where id = p_id;
    elsif p_action = 'unfeature' then update photos set featured = false where id = p_id;
    else raise exception 'bad input'; end if;
  else raise exception 'bad input';
  end if;
  insert into admin_log (admin_id, action, detail) values (a, 'moderate', json_build_object('kind', p_kind, 'id', p_id, 'action', p_action)::jsonb);
end $$;

create or replace function admin_find_users(p_email text)
returns table (id uuid, email text, username text, is_admin boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform need_admin();
  return query select u.id, u.email::text, p.username, p.is_admin, p.created_at from auth.users u join profiles p on p.id = u.id
    where u.email ilike '%' || replace(replace(btrim(p_email), '%', ''), '_', '\_') || '%' order by p.is_admin desc, u.email limit 20;
end $$;

-- The last admin can never be removed, so the dashboard cannot be locked out.
create or replace function admin_set_admin(p_user uuid, p_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
declare a uuid := need_admin();
begin
  if not p_admin and (select count(*) from profiles where is_admin) <= 1 and (select is_admin from profiles where id = p_user) then
    raise exception 'last admin';
  end if;
  update profiles set is_admin = p_admin where id = p_user;
  insert into admin_log (admin_id, action, detail) values (a, 'set_admin', json_build_object('user', p_user, 'admin', p_admin)::jsonb);
end $$;

create or replace function admin_log_recent() returns table (action text, detail jsonb, at timestamptz, by_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform need_admin();
  return query select l.action, l.detail, l.at, p.username from admin_log l left join profiles p on p.id = l.admin_id order by l.at desc limit 40;
end $$;

-- ---------- who may call what ----------
revoke execute on function unlock_perk(bigint), redeem_perk(bigint), my_perks(), need_admin(), admin_stats(), admin_set_flag(text, boolean),
  admin_set_vote_cap(int), admin_perks(), admin_save_perk(jsonb), admin_delete_perk(bigint), admin_save_merch(jsonb), admin_delete_merch(bigint),
  admin_reports(), admin_moderate(text, bigint, text), admin_find_users(text), admin_set_admin(uuid, boolean), admin_log_recent(),
  add_comment(text, text, text, text), add_photo(text, text, text, text) from public, anon;
grant execute on function unlock_perk(bigint), redeem_perk(bigint), my_perks(), admin_stats(), admin_set_flag(text, boolean),
  admin_set_vote_cap(int), admin_perks(), admin_save_perk(jsonb), admin_delete_perk(bigint), admin_save_merch(jsonb), admin_delete_merch(bigint),
  admin_reports(), admin_moderate(text, bigint, text), admin_find_users(text), admin_set_admin(uuid, boolean), admin_log_recent(),
  add_comment(text, text, text, text), add_photo(text, text, text, text) to authenticated;
grant execute on function flag_on(text) to anon, authenticated;
