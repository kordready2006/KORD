-- KORD photo quality controls. Run once in the Supabase SQL Editor, after photos.sql. Safe to run more than once.
-- A student photo shows on its dish right away, but only becomes the cover picture of a deal or restaurant when
-- you set featured = true on its row, or two different phones tap "Looks right" on it.

alter table photos add column if not exists featured boolean not null default false;

create table if not exists photo_likes (
  photo_id   bigint not null references photos (id) on delete cascade,
  device     uuid   not null,
  created_at timestamptz not null default now(),
  primary key (photo_id, device)
);
alter table photo_likes enable row level security;

create or replace view dish_photos as
  select p.id, p.town, p.place_id, p.dish, p.path, p.created_at, p.featured,
         (select count(*) from photo_likes l where l.photo_id = p.id)::int as likes
  from photos p where not p.hidden;

create or replace function like_photo(p_device uuid, p_photo bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into photo_likes (photo_id, device) values (p_photo, p_device) on conflict do nothing;
end $$;

grant select on dish_photos to anon;
grant execute on function like_photo(uuid, bigint) to anon;
