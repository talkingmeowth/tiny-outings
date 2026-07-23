-- Keep catalogue copy readable in the mobile UI while removing non-ASCII
-- symbols, emoji, curly punctuation, and malformed import characters.
create extension if not exists unaccent;

create or replace function public.normalize_activity_display_text(value text)
returns text
language sql
immutable
as $$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(unaccent(coalesce(value, '')), E'[^\\x00-\\x7F]', '', 'g'),
        E'\\s+', ' ', 'g'
      )
    ),
    ''
  );
$$;

create or replace function public.normalize_activity_cost(value text)
returns text
language sql
immutable
as $$
  select nullif(
    btrim(regexp_replace(coalesce(public.normalize_activity_display_text(value), ''), '[^A-Za-z0-9 .,\\-]', '', 'g')),
    ''
  );
$$;

update public.activities
set
  activity_name = coalesce(public.normalize_activity_display_text(activity_name), 'Activity'),
  address = coalesce(public.normalize_activity_display_text(address), 'London'),
  postcode = public.normalize_activity_display_text(postcode),
  category = coalesce(public.normalize_activity_display_text(category), 'Family activities'),
  age_suitability = public.normalize_activity_display_text(age_suitability),
  borough = coalesce(public.normalize_activity_display_text(borough), 'London'),
  recurrence_rule = public.normalize_activity_display_text(recurrence_rule),
  schedule_notes = public.normalize_activity_display_text(schedule_notes),
  description = public.normalize_activity_display_text(description),
  cost = public.normalize_activity_cost(cost),
  source_name = public.normalize_activity_display_text(source_name),
  data_source = public.normalize_activity_display_text(data_source),
  availability_notes = public.normalize_activity_display_text(availability_notes),
  days_of_week = coalesce(array(
    select public.normalize_activity_display_text(day_name)
    from unnest(days_of_week) as day_name
    where public.normalize_activity_display_text(day_name) is not null
  ), '{}'),
  available_days_of_week = coalesce(array(
    select public.normalize_activity_display_text(day_name)
    from unnest(available_days_of_week) as day_name
    where public.normalize_activity_display_text(day_name) is not null
  ), '{}'),
  updated_at = now();
