-- Keep authoritative government event/timetable pages while rejecting broad
-- council and GOV.UK destinations that do not identify a specific activity.
create or replace function public.is_generic_government_activity_url(candidate text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when nullif(trim(candidate), '') is null then false
    when trim(candidate) !~* '^https?://([^/?#]+\.)?gov\.uk(?::[0-9]+)?(?:[/?#]|$)' then false
    when trim(candidate) ~* '^https?://(www\.)?gov\.uk(?:[/?#]|$)' then true
    when trim(candidate) ~* '^https?://(www\.)?[^./?#]+\.gov\.uk/?(?:[?#].*)?$' then true
    when trim(candidate) ~* '^https?://(?:education|families|fsd|libraries|localoffer)\.[^./?#]+\.gov\.uk/?(?:[?#].*)?$' then true
    when lower(split_part(split_part(trim(candidate), '#', 1), '?', 1)) ~
      '/(best-start-family-hubs|brightstart|community-parks-leisure|events|families-young-people-and-children|family-hubs|familywellbeingcentres|find-your-local-park|libraries|our-historical-parks|our-other-parks|other-green-spaces|parks|parks-and-open-spaces|supporting-children-and-young-people|your-local-parks)/?$'
      then true
    when lower(split_part(split_part(trim(candidate), '#', 1), '?', 1)) ~
      '/government/publications/list-of-family-hub-sites/?$'
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
     and new.source_name in (
       'GOV.UK Family Hubs and Start for Life',
       'Hackney Children''s Centres',
       'London family hub official timetables',
       'London Borough of Waltham Forest events',
       'Waltham Forest Best Start in Life events',
       'Woodberry Down Children and Family Hub'
     )
     and (
       new.source_name = 'GOV.UK Family Hubs and Start for Life'
       or new.start_time is null
       or new.end_time is null
       or (new.activity_date is null and coalesce(cardinality(new.available_dates), 0) = 0)
     ) then
    if new.public_listing_status in ('published', 'draft') then
      new.archive_previous_listing_status := new.public_listing_status;
    end if;
    new.public_listing_status := 'archived';
    new.archive := true;
    new.archive_reason := 'Scheduled family activity removed: no verified exact occurrence date and start/end time.';
    new.archived_at := coalesce(new.archived_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists activities_specific_link_and_schedule_guard on public.activities;
create trigger activities_specific_link_and_schedule_guard
before insert or update of website, organiser_website, source_name, public_listing_status,
  archive, start_time, end_time, activity_date, available_dates
on public.activities
for each row
execute function public.enforce_specific_activity_link_and_schedule();

-- Importers normally cannot revive an archived row. Permit one narrow repair:
-- a row archived by this schedule guard may return only after the importer has
-- supplied exact dates and both times. Manual/admin archive decisions remain
-- final until an administrator explicitly restores them.
create or replace function public.preserve_archived_activity_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (old.archive is true or old.public_listing_status = 'archived')
     and coalesce(current_setting('tiny_outings.allow_unarchive', true), '') <> 'on'
     and not (
       old.archive_reason = 'Scheduled family activity removed: no verified exact occurrence date and start/end time.'
       and new.start_time is not null
       and new.end_time is not null
       and (new.activity_date is not null or coalesce(cardinality(new.available_dates), 0) > 0)
       and new.source_name in (
         'Hackney Children''s Centres',
         'London family hub official timetables',
         'London Borough of Waltham Forest events',
         'Waltham Forest Best Start in Life events',
         'Woodberry Down Children and Family Hub'
       )
     ) then
    new.archive = true;
    new.public_listing_status = 'archived';
  end if;
  return new;
end;
$$;

-- Clean existing broad links now; the trigger keeps later imports clean.
update public.activities
set
  website = case when public.is_generic_government_activity_url(website) then null else website end,
  organiser_website = case when public.is_generic_government_activity_url(organiser_website) then null else organiser_website end,
  updated_at = now()
where public.is_generic_government_activity_url(website)
   or public.is_generic_government_activity_url(organiser_website);

-- Touch the affected scheduled sources so the guard archives every legacy or
-- incomplete family-activity card already present in production.
update public.activities
set source_name = source_name,
    updated_at = now()
where coalesce(archive, false) = false
  and public_listing_status in ('published', 'draft')
  and source_name in (
    'GOV.UK Family Hubs and Start for Life',
    'Hackney Children''s Centres',
    'London family hub official timetables',
    'London Borough of Waltham Forest events',
    'Waltham Forest Best Start in Life events',
    'Woodberry Down Children and Family Hub'
  );
