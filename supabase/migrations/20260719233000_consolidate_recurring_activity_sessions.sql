-- Merge duplicate recurring sessions into one card per provider, venue, and day window.
-- One-off and date-specific events stay separate, and superseded records are archived
-- so existing user plans, reviews, and comments keep their activity references.
alter table public.activities
  drop constraint if exists activities_public_listing_status_check;

alter table public.activities
  add constraint activities_public_listing_status_check
  check (public_listing_status in ('draft', 'published', 'archived'));

with duplicate_groups as (
  select
    activity_name,
    address,
    category,
    coalesce(nullif(btrim(organiser_website), ''), nullif(btrim(website), ''), nullif(btrim(source_url), ''), '') as provider_key,
    time_window,
    (array_agg(activity_id order by created_at asc, activity_id))[1] as keeper_id,
    min(start_time) as earliest_start_time,
    max(end_time) as latest_end_time
  from public.activities
  where public_listing_status = 'published'
    and activity_date is null
    and coalesce(availability_type, 'unknown') not in ('one_off', 'specific_dates')
  group by 1, 2, 3, 4, 5
  having count(*) > 1
), merged_values as (
  select
    groups.*,
    coalesce((
      select array_agg(distinct day order by day)
      from public.activities as sessions
      cross join lateral unnest(sessions.days_of_week) as day
      where sessions.public_listing_status = 'published'
        and sessions.activity_date is null
        and coalesce(sessions.availability_type, 'unknown') not in ('one_off', 'specific_dates')
        and sessions.activity_name = groups.activity_name
        and sessions.address = groups.address
        and sessions.category = groups.category
        and sessions.time_window = groups.time_window
        and coalesce(nullif(btrim(sessions.organiser_website), ''), nullif(btrim(sessions.website), ''), nullif(btrim(sessions.source_url), ''), '') = groups.provider_key
    ), array[]::text[]) as merged_days_of_week,
    coalesce((
      select array_agg(distinct day order by day)
      from public.activities as sessions
      cross join lateral unnest(sessions.available_days_of_week) as day
      where sessions.public_listing_status = 'published'
        and sessions.activity_date is null
        and coalesce(sessions.availability_type, 'unknown') not in ('one_off', 'specific_dates')
        and sessions.activity_name = groups.activity_name
        and sessions.address = groups.address
        and sessions.category = groups.category
        and sessions.time_window = groups.time_window
        and coalesce(nullif(btrim(sessions.organiser_website), ''), nullif(btrim(sessions.website), ''), nullif(btrim(sessions.source_url), ''), '') = groups.provider_key
    ), array[]::text[]) as merged_available_days,
    coalesce((
      select array_agg(distinct date_value order by date_value)
      from public.activities as sessions
      cross join lateral unnest(sessions.available_dates) as date_value
      where sessions.public_listing_status = 'published'
        and sessions.activity_date is null
        and coalesce(sessions.availability_type, 'unknown') not in ('one_off', 'specific_dates')
        and sessions.activity_name = groups.activity_name
        and sessions.address = groups.address
        and sessions.category = groups.category
        and sessions.time_window = groups.time_window
        and coalesce(nullif(btrim(sessions.organiser_website), ''), nullif(btrim(sessions.website), ''), nullif(btrim(sessions.source_url), ''), '') = groups.provider_key
    ), array[]::date[]) as merged_available_dates,
    (
      select min(sessions.availability_start_date)
      from public.activities as sessions
      where sessions.public_listing_status = 'published'
        and sessions.activity_date is null
        and coalesce(sessions.availability_type, 'unknown') not in ('one_off', 'specific_dates')
        and sessions.activity_name = groups.activity_name
        and sessions.address = groups.address
        and sessions.category = groups.category
        and sessions.time_window = groups.time_window
        and coalesce(nullif(btrim(sessions.organiser_website), ''), nullif(btrim(sessions.website), ''), nullif(btrim(sessions.source_url), ''), '') = groups.provider_key
    ) as merged_availability_start_date,
    (
      select max(sessions.availability_end_date)
      from public.activities as sessions
      where sessions.public_listing_status = 'published'
        and sessions.activity_date is null
        and coalesce(sessions.availability_type, 'unknown') not in ('one_off', 'specific_dates')
        and sessions.activity_name = groups.activity_name
        and sessions.address = groups.address
        and sessions.category = groups.category
        and sessions.time_window = groups.time_window
        and coalesce(nullif(btrim(sessions.organiser_website), ''), nullif(btrim(sessions.website), ''), nullif(btrim(sessions.source_url), ''), '') = groups.provider_key
    ) as merged_availability_end_date
  from duplicate_groups as groups
)
update public.activities as activities
set
  start_time = merged_values.earliest_start_time,
  end_time = merged_values.latest_end_time,
  days_of_week = merged_values.merged_days_of_week,
  available_days_of_week = merged_values.merged_available_days,
  available_dates = merged_values.merged_available_dates,
  availability_start_date = merged_values.merged_availability_start_date,
  availability_end_date = merged_values.merged_availability_end_date,
  updated_at = now()
from merged_values
where activities.activity_id = merged_values.keeper_id;

with duplicate_groups as (
  select
    activity_name,
    address,
    category,
    coalesce(nullif(btrim(organiser_website), ''), nullif(btrim(website), ''), nullif(btrim(source_url), ''), '') as provider_key,
    time_window,
    (array_agg(activity_id order by created_at asc, activity_id))[1] as keeper_id
  from public.activities
  where public_listing_status = 'published'
    and activity_date is null
    and coalesce(availability_type, 'unknown') not in ('one_off', 'specific_dates')
  group by 1, 2, 3, 4, 5
  having count(*) > 1
)
update public.activities as activities
set
  public_listing_status = 'archived',
  updated_at = now()
from duplicate_groups as groups
where activities.public_listing_status = 'published'
  and activities.activity_date is null
  and coalesce(activities.availability_type, 'unknown') not in ('one_off', 'specific_dates')
  and activities.activity_id <> groups.keeper_id
  and activities.activity_name = groups.activity_name
  and activities.address = groups.address
  and activities.category = groups.category
  and activities.time_window = groups.time_window
  and coalesce(nullif(btrim(activities.organiser_website), ''), nullif(btrim(activities.website), ''), nullif(btrim(activities.source_url), ''), '') = groups.provider_key;
