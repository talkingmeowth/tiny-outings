-- The app's planning filters are stored explicitly so imports cannot rely on
-- frontend keyword matching to decide where an activity appears.
alter table public.activities
  add column if not exists plan_filters text[] not null default '{}';

create or replace function public.activity_plan_filters(
  p_category text,
  p_data_source text,
  p_source_name text
)
returns text[]
language plpgsql
immutable
as $$
begin
  if coalesce(p_data_source, '') in ('eventbrite', 'fever')
    or coalesce(p_source_name, '') ilike '%eventbrite%'
    or coalesce(p_source_name, '') ilike '%fever%'
  then
    return array['Events'];
  end if;

  case coalesce(p_category, '')
    when 'Baby yoga' then return array['Baby classes'];
    when 'Baby massage' then return array['Baby classes'];
    when 'Baby sensory' then return array['Baby classes'];
    when 'Music & singing' then return array['Baby classes'];
    when 'Baby signing' then return array['Baby classes'];
    when 'Baby swimming' then return array['Baby classes'];
    when 'Postnatal fitness' then return array['Baby classes'];
    when 'Baby dance & movement' then return array['Baby classes'];
    when 'Developmental play' then return array['Baby classes'];
    when 'Stay & play' then return array['Play & learn'];
    when 'Story & rhyme time' then return array['Play & learn'];
    when 'Arts & crafts' then return array['Play & learn'];
    when 'Soft play' then return array['Play & learn'];
    when 'Family hubs' then return array['Play & learn'];
    when 'Child-friendly cafes' then return array['Food & socials'];
    when 'Bookshops' then return array['Food & socials'];
    when 'Parent meet-ups' then return array['Food & socials'];
    when 'Feeding & postnatal support' then return array['Food & socials'];
    when 'Parks & outdoor play' then return array['Parks'];
    when 'Museums & culture' then return array['Days out'];
    when 'Baby & toddler cinema' then return array['Days out'];
    when 'Family activities' then return array['Days out'];
    else return array['Days out'];
  end case;
end;
$$;

create or replace function public.set_activity_plan_filters()
returns trigger
language plpgsql
as $$
begin
  new.plan_filters := public.activity_plan_filters(new.category, new.data_source, new.source_name);
  return new;
end;
$$;

drop trigger if exists set_activities_plan_filters on public.activities;

create trigger set_activities_plan_filters
before insert or update of category, data_source, source_name on public.activities
for each row execute function public.set_activity_plan_filters();

update public.activities
set plan_filters = public.activity_plan_filters(category, data_source, source_name);

alter table public.activities
  drop constraint if exists activities_plan_filters_allowed;

alter table public.activities
  add constraint activities_plan_filters_allowed check (
    cardinality(plan_filters) = 1
    and plan_filters <@ array['Baby classes', 'Play & learn', 'Food & socials', 'Parks', 'Days out', 'Events']::text[]
  );

create index if not exists activities_plan_filters_idx
  on public.activities using gin (plan_filters);

comment on column public.activities.plan_filters is
  'One deterministic app planning filter: Baby classes, Play & learn, Food & socials, Parks, Days out, or Events.';
