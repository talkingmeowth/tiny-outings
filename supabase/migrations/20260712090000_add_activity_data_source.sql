alter table public.activities
  add column if not exists data_source text;

create or replace function public.set_activity_data_source()
returns trigger
language plpgsql
as $$
begin
  new.data_source := case
    when coalesce(new.source_name, '') ilike '%happity%' then 'happity'
    when coalesce(new.source_name, '') ilike '%best start%' or coalesce(new.source_name, '') ilike '%family hub%' then 'better_start_for_life'
    when coalesce(new.source_name, '') ilike '%eventbrite%' then 'eventbrite'
    when coalesce(new.source_name, '') ilike '%fever%' then 'fever'
    when coalesce(new.source_name, '') ilike '%google places%' then 'google_places'
    when coalesce(new.source_name, '') ilike '%directory%' then 'local_directory'
    when coalesce(new.source_name, '') ilike '%community%' then 'community'
    else 'other'
  end;
  return new;
end;
$$;

drop trigger if exists set_activities_data_source on public.activities;

create trigger set_activities_data_source
before insert or update of source_name on public.activities
for each row execute function public.set_activity_data_source();

update public.activities
set source_name = source_name
where source_name is not null;

create index if not exists activities_data_source_idx
  on public.activities (data_source);

comment on column public.activities.data_source is
  'Normalized provenance category: happity, better_start_for_life, google_places, eventbrite, fever, local_directory, community, or other.';
