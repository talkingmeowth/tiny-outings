-- A listing should only surface an organiser link when it is distinct from the
-- activity website. This keeps card actions concise and prevents duplicate
-- buttons from future importer or admin updates.
create or replace function public.clear_duplicate_activity_organiser_website()
returns trigger
language plpgsql
as $$
declare
  website_key text;
  organiser_key text;
begin
  website_key := regexp_replace(
    regexp_replace(
      regexp_replace(lower(trim(coalesce(new.website, ''))), '^https?://(www\.)?', ''),
      '[?#].*$',
      ''
    ),
    '/+$',
    ''
  );
  organiser_key := regexp_replace(
    regexp_replace(
      regexp_replace(lower(trim(coalesce(new.organiser_website, ''))), '^https?://(www\.)?', ''),
      '[?#].*$',
      ''
    ),
    '/+$',
    ''
  );

  if website_key <> '' and website_key = organiser_key then
    new.organiser_website := null;
  end if;
  return new;
end;
$$;

drop trigger if exists activities_clear_duplicate_organiser_website on public.activities;
create trigger activities_clear_duplicate_organiser_website
before insert or update of website, organiser_website on public.activities
for each row execute function public.clear_duplicate_activity_organiser_website();

update public.activities
set organiser_website = null,
    updated_at = now()
where nullif(trim(website), '') is not null
  and nullif(trim(organiser_website), '') is not null
  and regexp_replace(regexp_replace(regexp_replace(lower(trim(website)), '^https?://(www\.)?', ''), '[?#].*$', ''), '/+$', '')
      = regexp_replace(regexp_replace(regexp_replace(lower(trim(organiser_website)), '^https?://(www\.)?', ''), '[?#].*$', ''), '/+$', '');
