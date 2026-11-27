-- KORD student photos. Run this once in the Supabase SQL Editor, after schema.sql.
-- Students upload a photo of a dish; everyone at that school sees it. Safe to run more than once.

create table if not exists photos (
  id         bigint generated always as identity primary key,
  device     uuid        not null,
  town       text        not null,
  place_id   text        not null,
  dish       text        not null,
  path       text        not null unique,          -- file name inside the dish-photos bucket
  hidden     boolean     not null default false,   -- set true in the table editor to take a photo down
  created_at timestamptz not null default now()
);
create index if not exists photos_town on photos (town, created_at desc);
alter table photos enable row level security;

create table if not exists photo_reports (
  photo_id   bigint not null references photos (id) on delete cascade,
  device     uuid   not null,
  created_at timestamptz not null default now(),
  primary key (photo_id, device)
);
alter table photo_reports enable row level security;
-- No policies on purpose: the public key cannot read or write these tables directly.

create or replace view dish_photos as
  select id, town, place_id, dish, path, created_at from photos where not hidden;

-- Record an uploaded photo. The file must already be in the bucket, inside the phone's own folder. 12 photos per phone per day.
create or replace function add_photo(p_device uuid, p_town text, p_place text, p_dish text, p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if length(p_town) > 40 or length(p_place) > 120 or length(p_dish) not between 1 and 80
     or p_path !~ ('^' || p_device::text || '/[0-9a-f-]{36}\.jpg$') then
    raise exception 'bad input';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'dish-photos' and name = p_path) then
    raise exception 'no such file';
  end if;
  if (select count(*) from photos where device = p_device and created_at > now() - interval '1 day') >= 12 then
    raise exception 'slow down';
  end if;
  insert into photos (device, town, place_id, dish, path) values (p_device, p_town, p_place, p_dish, p_path);
end $$;

-- Reports: one per phone per photo. Two different phones reporting a photo hides it until you review it.
create or replace function report_photo(p_device uuid, p_photo bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into photo_reports (photo_id, device) values (p_photo, p_device) on conflict do nothing;
  if (select count(*) from photo_reports where photo_id = p_photo) >= 2 then
    update photos set hidden = true where id = p_photo;
  end if;
end $$;

grant select on dish_photos to anon;
grant execute on function add_photo(uuid, text, text, text, text) to anon;
grant execute on function report_photo(uuid, bigint) to anon;

-- Where the files live: a public bucket that only takes JPEGs up to 1.5 MB. Phones may add files, never change or delete them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dish-photos', 'dish-photos', true, 1500000, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 1500000, allowed_mime_types = array['image/jpeg'];

drop policy if exists "students can add dish photos" on storage.objects;
create policy "students can add dish photos" on storage.objects
  for insert to anon with check (bucket_id = 'dish-photos');
