-- Keep admin decisions auditable and make every map link resolve to the
-- activity's verified coordinate, rather than a potentially stale place URI.
create or replace function public.record_admin_activity_curation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_values jsonb;
  updated_values jsonb;
begin
  if not public.is_tiny_outings_admin() then
    return new;
  end if;

  previous_values := jsonb_build_object(
    'user_image_url', old.user_image_url,
    'website', old.website,
    'organiser_website', old.organiser_website,
    'google_link', old.google_link,
    'google_place_uri', old.google_place_uri,
    'public_listing_status', old.public_listing_status
  );
  updated_values := jsonb_build_object(
    'user_image_url', new.user_image_url,
    'website', new.website,
    'organiser_website', new.organiser_website,
    'google_link', new.google_link,
    'google_place_uri', new.google_place_uri,
    'public_listing_status', new.public_listing_status
  );

  if previous_values is distinct from updated_values then
    insert into public.activity_curation_feedback (
      activity_id, admin_user_id, data_source, previous_values, updated_values
    ) values (
      new.activity_id, auth.uid(), new.data_source, previous_values, updated_values
    );
  end if;
  return new;
end;
$$;

drop trigger if exists record_admin_activity_curation on public.activities;
create trigger record_admin_activity_curation
after update of user_image_url, website, organiser_website, google_link, google_place_uri, public_listing_status
on public.activities
for each row
execute function public.record_admin_activity_curation();

update public.activities
set
  google_link = 'https://www.google.com/maps/search/?api=1&query=' || lat::text || '%2C' || long::text,
  google_place_uri = 'https://www.google.com/maps/search/?api=1&query=' || lat::text || '%2C' || long::text,
  updated_at = now()
where lat is not null
  and long is not null;
