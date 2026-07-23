-- Consolidate published records that describe the same named activity at the
-- same venue and provider. The canonical record covers every known session;
-- redundant records are archived instead of deleted to retain any user history.
begin;

with normalized as (
  select
    a.*,
    trim(regexp_replace(lower(trim(a.activity_name)), '[^a-z0-9]+', ' ', 'g')) as name_key,
    trim(regexp_replace(lower(trim(coalesce(nullif(a.postcode, ''), a.address))), '[^a-z0-9]+', ' ', 'g')) as venue_key,
    coalesce(
      nullif(trim(regexp_replace(lower(trim(coalesce(a.organiser_website, ''))), '[^a-z0-9]+', ' ', 'g')), ''),
      'source ' || trim(regexp_replace(lower(trim(coalesce(a.source_name, ''))), '[^a-z0-9]+', ' ', 'g'))
    ) as provider_key
  from public.activities a
  where a.public_listing_status = 'published'
), grouped as (
  select
    name_key,
    venue_key,
    provider_key,
    (array_agg(activity_id order by
      (website is not null) desc,
      (image_url is not null) desc,
      (description is not null) desc,
      created_at asc
    ))[1] as canonical_id,
    array_agg(activity_id) as activity_ids,
    min(start_time) as start_time,
    max(end_time) as end_time,
    min(availability_start_date) as availability_start_date,
    max(availability_end_date) as availability_end_date,
    case when count(distinct activity_date) = 1 then min(activity_date) else null end as activity_date,
    count(*) as record_count
  from normalized
  group by name_key, venue_key, provider_key
  having count(*) > 1
), consolidated as (
  select
    g.*,
    coalesce((
      select array_agg(day_name order by case day_name
        when 'Monday' then 1 when 'Tuesday' then 2 when 'Wednesday' then 3
        when 'Thursday' then 4 when 'Friday' then 5 when 'Saturday' then 6
        when 'Sunday' then 7 else 8 end)
      from (
        select distinct day_name
        from public.activities a
        cross join lateral unnest(coalesce(a.days_of_week, '{}')) as day_name
        where a.activity_id = any(g.activity_ids)
      ) days
    ), '{}') as all_days,
    coalesce((
      select array_agg(day_name order by case day_name
        when 'Monday' then 1 when 'Tuesday' then 2 when 'Wednesday' then 3
        when 'Thursday' then 4 when 'Friday' then 5 when 'Saturday' then 6
        when 'Sunday' then 7 else 8 end)
      from (
        select distinct day_name
        from public.activities a
        cross join lateral unnest(coalesce(a.available_days_of_week, '{}')) as day_name
        where a.activity_id = any(g.activity_ids)
      ) days
    ), '{}') as all_available_days,
    coalesce((
      select array_agg(available_date order by available_date)
      from (
        select distinct available_date
        from public.activities a
        cross join lateral unnest(coalesce(a.available_dates, '{}')) as available_date
        where a.activity_id = any(g.activity_ids)
      ) dates
    ), '{}') as all_available_dates
  from grouped g
)
update public.activities a
set
  start_time = c.start_time,
  end_time = c.end_time,
  days_of_week = c.all_days,
  available_days_of_week = c.all_available_days,
  available_dates = c.all_available_dates,
  activity_date = c.activity_date,
  availability_start_date = c.availability_start_date,
  availability_end_date = c.availability_end_date,
  recurrence_rule = case when cardinality(c.all_available_days) > 0
    then 'FREQ=WEEKLY;BYDAY=' || array_to_string(array(select upper(left(day_name, 2)) from unnest(c.all_available_days) as day_name), ',')
    else a.recurrence_rule
  end,
  schedule_notes = concat_ws(' ', a.schedule_notes, 'Multiple sessions consolidated; times vary within this range.'),
  availability_notes = concat_ws(' ', a.availability_notes, 'Multiple sessions consolidated; times vary within this range.'),
  availability_type = case
    when cardinality(c.all_available_days) = 7 then 'daily'
    when cardinality(c.all_available_days) > 0 then 'weekly'
    else a.availability_type
  end,
  updated_at = now()
from consolidated c
where a.activity_id = c.canonical_id;

with normalized as (
  select
    a.activity_id,
    trim(regexp_replace(lower(trim(a.activity_name)), '[^a-z0-9]+', ' ', 'g')) as name_key,
    trim(regexp_replace(lower(trim(coalesce(nullif(a.postcode, ''), a.address))), '[^a-z0-9]+', ' ', 'g')) as venue_key,
    coalesce(
      nullif(trim(regexp_replace(lower(trim(coalesce(a.organiser_website, ''))), '[^a-z0-9]+', ' ', 'g')), ''),
      'source ' || trim(regexp_replace(lower(trim(coalesce(a.source_name, ''))), '[^a-z0-9]+', ' ', 'g'))
    ) as provider_key,
    first_value(a.activity_id) over (
      partition by
        trim(regexp_replace(lower(trim(a.activity_name)), '[^a-z0-9]+', ' ', 'g')),
        trim(regexp_replace(lower(trim(coalesce(nullif(a.postcode, ''), a.address))), '[^a-z0-9]+', ' ', 'g')),
        coalesce(
          nullif(trim(regexp_replace(lower(trim(coalesce(a.organiser_website, ''))), '[^a-z0-9]+', ' ', 'g')), ''),
          'source ' || trim(regexp_replace(lower(trim(coalesce(a.source_name, ''))), '[^a-z0-9]+', ' ', 'g'))
        )
      order by (a.website is not null) desc, (a.image_url is not null) desc, (a.description is not null) desc, a.created_at asc
    ) as canonical_id
  from public.activities a
  where a.public_listing_status = 'published'
)
update public.activities a
set public_listing_status = 'archived', updated_at = now()
from normalized n
where a.activity_id = n.activity_id
  and n.activity_id <> n.canonical_id;

commit;
