-- KORD shared ratings, comments and order-click tracking.
-- Run this once in a Supabase project (SQL Editor > New query > paste > Run).
-- Phones never touch the tables directly: they read two summary views and call three functions.

create table if not exists ratings (
  device     uuid        not null,
  town       text        not null,
  place_id   text        not null,
  dish       text        not null,
  stars      smallint    not null check (stars between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (device, place_id, dish)
);
create index if not exists ratings_town on ratings (town);

create table if not exists comments (
  id         bigint generated always as identity primary key,
  device     uuid        not null,
  town       text        not null,
  place_id   text        not null,
  dish       text        not null,
  name       text        not null default 'Student',
  body       text        not null,
  hidden     boolean     not null default false,  -- set true in the table editor to take a comment down
  created_at timestamptz not null default now()
);
create index if not exists comments_place on comments (place_id, created_at desc);

create table if not exists order_clicks (
  id         bigint generated always as identity primary key,
  device     uuid        not null,
  town       text        not null,
  place_id   text        not null,
  created_at timestamptz not null default now()
);

alter table ratings      enable row level security;
alter table comments     enable row level security;
alter table order_clicks enable row level security;
-- No policies on purpose: the public key cannot read or write these tables.

create or replace view dish_scores as
  select town, place_id, dish, round(avg(stars)::numeric, 2) as avg, count(*)::int as n
  from ratings group by town, place_id, dish;

create or replace view dish_comments as
  select id, town, place_id, dish, name, body, created_at
  from comments where not hidden;

-- One rating per phone per dish, 1 to 10; stars = 0 removes it.
create or replace function rate_dish(p_device uuid, p_town text, p_place text, p_dish text, p_stars int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if length(p_town) > 40 or length(p_place) > 120 or length(p_dish) not between 1 and 80 then
    raise exception 'bad input';
  end if;
  if p_stars = 0 then
    delete from ratings where device = p_device and place_id = p_place and dish = p_dish;
  elsif p_stars between 1 and 10 then
    insert into ratings (device, town, place_id, dish, stars) values (p_device, p_town, p_place, p_dish, p_stars)
    on conflict (device, place_id, dish) do update set stars = excluded.stars, updated_at = now();
  else
    raise exception 'bad stars';
  end if;
end $$;

-- Comments: 1 to 280 characters, at most 6 per phone every 10 minutes.
create or replace function add_comment(p_device uuid, p_town text, p_place text, p_dish text, p_name text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_body text := btrim(p_body);
  v_name text := left(coalesce(nullif(btrim(p_name), ''), 'Student'), 30);
begin
  if length(v_body) not between 1 and 280 or length(p_town) > 40 or length(p_place) > 120 or length(p_dish) not between 1 and 80 then
    raise exception 'bad input';
  end if;
  if (select count(*) from comments where device = p_device and created_at > now() - interval '10 minutes') >= 6 then
    raise exception 'slow down';
  end if;
  insert into comments (device, town, place_id, dish, name, body) values (p_device, p_town, p_place, p_dish, v_name, v_body);
end $$;

create or replace function log_order(p_device uuid, p_town text, p_place text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if length(p_town) <= 40 and length(p_place) <= 120 then
    insert into order_clicks (device, town, place_id) values (p_device, p_town, p_place);
  end if;
end $$;

-- Reports: one per phone per comment. Three different phones reporting a comment hides it until you review it.
create table if not exists comment_reports (
  comment_id bigint not null references comments (id) on delete cascade,
  device     uuid   not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, device)
);
alter table comment_reports enable row level security;

create or replace function report_comment(p_device uuid, p_comment bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into comment_reports (comment_id, device) values (p_comment, p_device) on conflict do nothing;
  if (select count(*) from comment_reports where comment_id = p_comment) >= 3 then
    update comments set hidden = true where id = p_comment;
  end if;
end $$;

grant select on dish_scores, dish_comments to anon;
grant execute on function report_comment(uuid, bigint) to anon;
grant execute on function rate_dish(uuid, text, text, text, int) to anon;
grant execute on function add_comment(uuid, text, text, text, text, text) to anon;
grant execute on function log_order(uuid, text, text) to anon;
