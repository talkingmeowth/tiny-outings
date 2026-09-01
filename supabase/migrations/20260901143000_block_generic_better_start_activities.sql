-- Better Start and family-hub imports must create scheduled activities, never
-- venue-level placeholder cards.
create or replace function public.is_generic_family_activity_name(candidate text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(trim(candidate), '') ~* '^\s*(family[ -]?(hub )?activit(y|ies)|activities|children.?s centre activities|childrens centre activities)(\s+(at|in)\s+.+)?\s*$';
$$;

create or replace function public.is_better_start_scheduled_activity(
  candidate_source_name text,
  candidate_data_source text,
  candidate_activity_name text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when lower(coalesce(candidate_data_source, '')) in (
      'better_start_for_life',
      'better start for life',
      'official family hub timetable'
    ) then true
    when coalesce(candidate_source_name, '') ~* '(better start|best start|start for life)' then true
    when candidate_source_name in (
      'Hackney Children''s Centres',
      'London family hub official timetables',
      'London Borough of Waltham Forest events',
      'Waltham Forest Best Start in Life events',
      'Woodberry Down Children and Family Hub'
    ) then true
    when public.is_generic_family_activity_name(candidate_activity_name)
      and concat_ws(' ', candidate_source_name, candidate_data_source) ~* '(family[ -]?hub|children.?s centre|childrens centre)'
      then true
    else false
  end;
$$;

create or replace function public.enforce_specific_activity_link_and_schedule()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_generic_government_activity_url(new.website) then
    new.website := null;
  end if;
  if public.is_generic_government_activity_url(new.organiser_website) then
    new.organiser_website := null;
  end if;

  if coalesce(new.archive, false) = false
     and new.public_listing_status in ('published', 'draft')
     and public.is_better_start_scheduled_activity(new.source_name, new.data_source, new.activity_name)
     and (
       public.is_generic_family_activity_name(new.activity_name)
       or new.start_time is null
       or new.end_time is null
       or (new.activity_date is null and coalesce(cardinality(new.available_dates), 0) = 0)
     ) then
    new.archive_previous_listing_status := new.public_listing_status;
    new.public_listing_status := 'archived';
    new.archive := true;
    new.archive_reason := 'Scheduled family activity removed: generic venue card or no verified exact occurrence date and start/end time.';
    new.archived_at := coalesce(new.archived_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists activities_specific_link_and_schedule_guard on public.activities;
create trigger activities_specific_link_and_schedule_guard
before insert or update of website, organiser_website, source_name, data_source, activity_name,
  public_listing_status, archive, start_time, end_time, activity_date, available_dates
on public.activities
for each row
execute function public.enforce_specific_activity_link_and_schedule();

create or replace function public.preserve_archived_activity_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (old.archive is true or old.public_listing_status = 'archived')
     and coalesce(current_setting('tiny_outings.allow_unarchive', true), '') <> 'on'
     and not (
       old.archive_reason in (
         'Scheduled family activity removed: no verified exact occurrence date and start/end time.',
         'Scheduled family activity removed: generic venue card or no verified exact occurrence date and start/end time.'
       )
       and new.start_time is not null
       and new.end_time is not null
       and (new.activity_date is not null or coalesce(cardinality(new.available_dates), 0) > 0)
       and not public.is_generic_family_activity_name(new.activity_name)
       and public.is_better_start_scheduled_activity(new.source_name, new.data_source, new.activity_name)
     ) then
    new.archive = true;
    new.public_listing_status = 'archived';
  end if;
  return new;
end;
$$;

-- One-off cleanup. The before-update guard archives every active generic or
-- incomplete Better Start record while preserving its previous review status.
update public.activities
set source_name = source_name,
    updated_at = now()
where coalesce(archive, false) = false
  and public_listing_status in ('published', 'draft')
  and public.is_better_start_scheduled_activity(source_name, data_source, activity_name)
  and (
    public.is_generic_family_activity_name(activity_name)
    or start_time is null
    or end_time is null
    or (activity_date is null and coalesce(cardinality(available_dates), 0) = 0)
  );
