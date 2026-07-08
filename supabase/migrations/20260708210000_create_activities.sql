create extension if not exists pgcrypto;
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

create table if not exists public.activities (
  activity_id uuid primary key default gen_random_uuid(),
  activity_name text not null,
  address text not null,
  postcode text,
  lat numeric(9, 6),
  long numeric(9, 6),
  category text not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  google_link text,
  website text,
  child_friendly_score numeric(3, 2) check (
    child_friendly_score is null
    or child_friendly_score between 0 and 5
  ),
  app_rating numeric(3, 2) check (
    app_rating is null
    or app_rating between 0 and 5
  ),
  number_of_reviews integer not null default 0 check (number_of_reviews >= 0),
  age_suitability text,

  -- MVP metadata needed for filtering, recurring weekly sessions, and provenance.
  borough text not null default 'Waltham Forest',
  days_of_week text[] not null default '{}',
  recurrence_rule text,
  schedule_notes text,
  description text,
  cost text,
  booking_required boolean not null default false,
  source_name text,
  source_url text unique,
  public_listing_status text not null default 'published' check (
    public_listing_status in ('draft', 'published', 'archived')
  ),

  time_window text generated always as (
    case
      when start_time < time '12:00' then 'morning'
      when start_time < time '17:00' then 'afternoon'
      else 'evening'
    end
  ) stored,
  location extensions.geography(Point, 4326) generated always as (
    case
      when lat is not null and long is not null
      then extensions.st_setsrid(
        extensions.st_makepoint(long::double precision, lat::double precision),
        4326
      )::extensions.geography
      else null
    end
  ) stored,
  search_vector tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(activity_name, '') || ' ' ||
      coalesce(category, '') || ' ' ||
      coalesce(address, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(age_suitability, '')
    )
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint activities_valid_time_range check (end_time > start_time),
  constraint activities_lat_range check (lat is null or lat between -90 and 90),
  constraint activities_long_range check (long is null or long between -180 and 180)
);

create index if not exists activities_category_idx
  on public.activities (category);

create index if not exists activities_borough_idx
  on public.activities (borough);

create index if not exists activities_start_time_idx
  on public.activities (start_time);

create index if not exists activities_time_window_idx
  on public.activities (time_window);

create index if not exists activities_days_of_week_idx
  on public.activities using gin (days_of_week);

create index if not exists activities_search_vector_idx
  on public.activities using gin (search_vector);

create index if not exists activities_location_idx
  on public.activities using gist (location);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_activities_updated_at on public.activities;

create trigger set_activities_updated_at
before update on public.activities
for each row
execute function public.set_updated_at();

create or replace function public.activities_within_radius(
  p_lat double precision,
  p_long double precision,
  p_radius_meters integer
)
returns setof public.activities
language sql
stable
as $$
  select *
  from public.activities
  where location is not null
    and public_listing_status = 'published'
    and extensions.st_dwithin(
      location,
      extensions.st_setsrid(extensions.st_makepoint(p_long, p_lat), 4326)::extensions.geography,
      p_radius_meters
    )
  order by location <-> extensions.st_setsrid(
    extensions.st_makepoint(p_long, p_lat),
    4326
  )::extensions.geography;
$$;

alter table public.activities enable row level security;

drop policy if exists "Published activities are readable" on public.activities;

create policy "Published activities are readable"
on public.activities
for select
using (public_listing_status = 'published');
