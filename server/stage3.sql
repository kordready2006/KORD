-- KORD stage 3: The Wire (community feed), following, blocking, notifications, leaderboards, public profiles.
-- Run once in the Supabase SQL Editor, after stage2.sql. Safe to run more than once.

alter table profiles add column if not exists rules_accepted_at timestamptz;

-- ---------- posts ----------
create table if not exists posts (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references profiles (id) on delete cascade,
  town       text not null,
  body       text not null check (length(body) between 1 and 500),
  photo_path text,                                  -- file in the dish-photos bucket, inside the author's own folder
  hidden     boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists posts_town on posts (town, created_at desc);
create index if not exists posts_user on posts (user_id, created_at desc);
alter table posts enable row level security;

create table if not exists post_reports (
  post_id bigint not null references posts (id) on delete cascade, user_id uuid not null, created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table post_reports enable row level security;

-- ---------- following and blocking ----------
create table if not exists follows (
  follower uuid not null references profiles (id) on delete cascade,
  followee uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee), check (follower <> followee)
);
create index if not exists follows_followee on follows (followee);
alter table follows enable row level security;

create table if not exists blocks (
  blocker uuid not null references profiles (id) on delete cascade,
  blocked uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked), check (blocker <> blocked)
);
alter table blocks enable row level security;

create table if not exists notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  kind text not null, actor uuid references profiles (id) on delete cascade,
  created_at timestamptz not null default now(), read_at timestamptz
);
create index if not exists notifications_user on notifications (user_id, created_at desc);
alter table notifications enable row level security;

-- ---------- community rules ----------
create or replace function accept_rules() returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in'; end if;
  update profiles set rules_accepted_at = coalesce(rules_accepted_at, now()) where id = auth.uid();
end $$;

create or replace function my_profile() returns json language sql stable security definer set search_path = public as $$
  select json_build_object('id', id, 'username', username, 'town', town, 'is_admin', is_admin, 'rules', rules_accepted_at is not null)
  from profiles where id = auth.uid();
$$;

-- ---------- The Wire ----------
create or replace function add_post(p_town text, p_body text, p_path text)
returns bigint language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v text := btrim(p_body); pth text := nullif(p_path, ''); new_id bigint;
begin
  if uid is null then raise exception 'sign in'; end if;
  if not flag_on('community') then raise exception 'switched off'; end if;
  if (select rules_accepted_at from profiles where id = uid) is null then raise exception 'accept rules'; end if;
  if length(v) not between 1 and 500 or length(p_town) not between 1 and 40 then raise exception 'bad input'; end if;
  if pth is not null and (pth !~ ('^' || uid::text || '/[0-9a-f-]{36}\.jpg$')
     or not exists (select 1 from storage.objects where bucket_id = 'dish-photos' and name = pth)) then raise exception 'bad input'; end if;
  if (select count(*) from posts where user_id = uid and created_at > now() - interval '1 day') >= 10 then raise exception 'slow down'; end if;
  insert into posts (user_id, town, body, photo_path) values (uid, p_town, v, pth) returning id into new_id;
  return new_id;
end $$;

-- Newest first. Leaves out hidden posts, and posts by anyone the reader has blocked or who has blocked the reader.
create or replace function wire_feed(p_town text, p_friends boolean default false)
returns table (id bigint, user_id uuid, username text, body text, photo_path text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.user_id, pr.username, p.body, p.photo_path, p.created_at
  from posts p join profiles pr on pr.id = p.user_id
  where not p.hidden and flag_on('community')
    and (case when p_friends then exists (select 1 from follows f where f.follower = auth.uid() and f.followee = p.user_id) else p.town = p_town end)
    and not exists (select 1 from blocks b where (b.blocker = auth.uid() and b.blocked = p.user_id) or (b.blocker = p.user_id and b.blocked = auth.uid()))
  order by p.created_at desc limit 60;
$$;

create or replace function delete_post(p_post bigint) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in'; end if;
  delete from posts where id = p_post and user_id = auth.uid();
end $$;

create or replace function report_post(p_post bigint) returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in'; end if;
  insert into post_reports (post_id, user_id) values (p_post, uid) on conflict do nothing;
  if (select count(*) from post_reports where post_id = p_post) >= 3 then update posts set hidden = true where id = p_post; end if;
end $$;

-- ---------- follow, unfollow, block ----------
create or replace function follow_user(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); added int;
begin
  if uid is null then raise exception 'sign in'; end if;
  if not flag_on('friends') then raise exception 'switched off'; end if;
  if uid = p_user then raise exception 'bad input'; end if;
  if exists (select 1 from blocks where (blocker = uid and blocked = p_user) or (blocker = p_user and blocked = uid)) then raise exception 'blocked'; end if;
  insert into follows (follower, followee) values (uid, p_user) on conflict do nothing;
  get diagnostics added = row_count;
  if added = 1 then insert into notifications (user_id, kind, actor) values (p_user, 'follow', uid); end if;
end $$;

create or replace function unfollow_user(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in'; end if;
  delete from follows where follower = auth.uid() and followee = p_user;
end $$;

-- Blocking also ends any following between the two accounts.
create or replace function block_user(p_user uuid, p_block boolean) returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in'; end if;
  if uid = p_user then raise exception 'bad input'; end if;
  if p_block then
    insert into blocks (blocker, blocked) values (uid, p_user) on conflict do nothing;
    delete from follows where (follower = uid and followee = p_user) or (follower = p_user and followee = uid);
  else
    delete from blocks where blocker = uid and blocked = p_user;
  end if;
end $$;

create or replace function my_notifications() returns table (id bigint, kind text, actor uuid, username text, created_at timestamptz, is_new boolean)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in'; end if;
  return query select n.id, n.kind, n.actor, p.username, n.created_at, n.read_at is null
    from notifications n left join profiles p on p.id = n.actor where n.user_id = auth.uid() order by n.created_at desc limit 30;
  update notifications set read_at = now() where user_id = auth.uid() and read_at is null;
end $$;

-- ---------- leaderboards and profiles ----------
-- The Hall: accounts ranked by number of dishes rated (ties: earlier account first). p_town = null gives the global Hall.
create or replace function leaderboard(p_town text default null)
returns table (pos bigint, user_id uuid, username text, rated bigint)
language sql stable security definer set search_path = public as $$
  select row_number() over (order by count(*) desc, min(pr.created_at)), pr.id, pr.username, count(*)
  from ratings r join profiles pr on pr.id = r.device
  where flag_on('standings') and (p_town is null or r.town = p_town)
  group by pr.id, pr.username order by 1 limit 100;
$$;

create or replace function user_profile(p_user uuid) returns json
language sql stable security definer set search_path = public as $$
  with ranked as (select pr.id, row_number() over (order by count(r.*) desc, min(pr.created_at)) as pos
                  from profiles pr left join ratings r on r.device = pr.id group by pr.id)
  select json_build_object(
    'id', p.id, 'username', p.username, 'joined', p.created_at,
    'rank', (select pos from ranked where id = p.id),
    'rated', (select count(*) from ratings where device = p.id),
    'highest', (select max(stars) from ratings where device = p.id),
    'perks', (select count(*) from perk_unlocks where user_id = p.id),
    'followers', (select count(*) from follows where followee = p.id),
    'following', (select count(*) from follows where follower = p.id),
    'is_following', exists (select 1 from follows where follower = auth.uid() and followee = p.id),
    'is_blocked', exists (select 1 from blocks where blocker = auth.uid() and blocked = p.id),
    'been_there', (select coalesce(json_agg(x), '[]') from (select place_id, count(*)::int as dishes, round(avg(stars)::numeric, 1) as avg, max(updated_at) as last
                   from ratings where device = p.id group by place_id order by max(updated_at) desc limit 30) x),
    'top_tasted', (select coalesce(json_agg(x), '[]') from (select place_id, dish, stars from ratings where device = p.id order by stars desc, updated_at desc limit 10) x))
  from profiles p where p.id = p_user
    and not exists (select 1 from blocks b where b.blocker = p.id and b.blocked = auth.uid());
$$;

-- People I follow: what they rated lately.
create or replace function friends_activity()
returns table (user_id uuid, username text, place_id text, dish text, stars smallint, at timestamptz)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.username, r.place_id, r.dish, r.stars, r.updated_at
  from follows f join profiles pr on pr.id = f.followee join ratings r on r.device = f.followee
  where f.follower = auth.uid() and flag_on('friends') order by r.updated_at desc limit 40;
$$;

-- ---------- account deletion now also clears community data ----------
create or replace function my_photo_paths() returns setof text language sql stable security definer set search_path = public as $$
  select path from photos where device = auth.uid()
  union all select photo_path from posts where user_id = auth.uid() and photo_path is not null;
$$;

create or replace function delete_account()
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in'; end if;
  if (select is_admin from profiles where id = uid) and (select count(*) from profiles where is_admin) <= 1 then raise exception 'last admin'; end if;
  delete from ratings where device = uid;
  delete from comments where device = uid;
  delete from comment_reports where device = uid;
  delete from photo_reports where device = uid;
  delete from photo_likes where device = uid;
  delete from photos where device = uid;
  delete from vote_log where user_id = uid;
  delete from post_reports where user_id = uid;
  delete from perk_unlocks where user_id = uid;
  delete from place_views where viewer = uid;
  delete from auth.users where id = uid;     -- profile, posts, follows, blocks and notifications go with it
end $$;

-- ---------- admin: posts join the moderation queue and the stats ----------
create or replace function admin_reports() returns json language plpgsql stable security definer set search_path = public as $$
begin
  perform need_admin();
  return json_build_object(
    'comments', (select coalesce(json_agg(x), '[]') from (
      select c.id, c.place_id, c.dish, c.name, c.body, c.hidden, c.created_at, count(r.*)::int as reports
      from comments c join comment_reports r on r.comment_id = c.id group by c.id order by count(r.*) desc, c.created_at desc limit 100) x),
    'photos', (select coalesce(json_agg(x), '[]') from (
      select p.id, p.place_id, p.dish, p.path, p.hidden, p.featured, p.created_at, count(r.*)::int as reports
      from photos p join photo_reports r on r.photo_id = p.id group by p.id order by count(r.*) desc, p.created_at desc limit 100) x),
    'posts', (select coalesce(json_agg(x), '[]') from (
      select p.id, p.town, pr.username as name, p.body, p.photo_path, p.hidden, p.created_at, count(r.*)::int as reports
      from posts p join post_reports r on r.post_id = p.id join profiles pr on pr.id = p.user_id
      group by p.id, pr.username order by count(r.*) desc, p.created_at desc limit 100) x));
end $$;

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
  elsif p_kind = 'post' then
    if p_action = 'hide' then update posts set hidden = true where id = p_id;
    elsif p_action = 'show' then update posts set hidden = false where id = p_id; delete from post_reports where post_id = p_id;
    elsif p_action = 'delete' then delete from posts where id = p_id;
    else raise exception 'bad input'; end if;
  else raise exception 'bad input';
  end if;
  insert into admin_log (admin_id, action, detail) values (a, 'moderate', json_build_object('kind', p_kind, 'id', p_id, 'action', p_action)::jsonb);
end $$;

create or replace function admin_community() returns json language plpgsql stable security definer set search_path = public as $$
begin
  perform need_admin();
  return json_build_object('posts', (select count(*) from posts where not hidden), 'posts_7d', (select count(*) from posts where created_at > now() - interval '7 days'),
    'follows', (select count(*) from follows), 'blocks', (select count(*) from blocks));
end $$;

-- ---------- who may call what ----------
revoke execute on function accept_rules(), add_post(text, text, text), delete_post(bigint), report_post(bigint), follow_user(uuid), unfollow_user(uuid),
  block_user(uuid, boolean), my_notifications(), friends_activity(), my_photo_paths(), delete_account(), my_profile(),
  admin_reports(), admin_moderate(text, bigint, text), admin_community() from public, anon;
grant execute on function accept_rules(), add_post(text, text, text), delete_post(bigint), report_post(bigint), follow_user(uuid), unfollow_user(uuid),
  block_user(uuid, boolean), my_notifications(), friends_activity(), my_photo_paths(), delete_account(), my_profile(),
  admin_reports(), admin_moderate(text, bigint, text), admin_community() to authenticated;
grant execute on function wire_feed(text, boolean), leaderboard(text), user_profile(uuid) to anon, authenticated;
