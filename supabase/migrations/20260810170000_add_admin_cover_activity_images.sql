-- A file chosen by an administrator is the definitive activity cover image.
-- Keep it distinct from a manually pasted image URL and parent-contributed photos.
alter table public.activities
  add column if not exists admin_cover_image_url text;

comment on column public.activities.admin_cover_image_url is
  'Administrator-uploaded cover image URL. Takes priority over all other activity image sources.';

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
    'admin_cover_image_url', old.admin_cover_image_url,
    'user_image_url', old.user_image_url,
    'website', old.website,
    'organiser_website', old.organiser_website,
    'google_link', old.google_link,
    'google_place_uri', old.google_place_uri,
    'public_listing_status', old.public_listing_status
  );
  updated_values := jsonb_build_object(
    'admin_cover_image_url', new.admin_cover_image_url,
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
after update of admin_cover_image_url, user_image_url, website, organiser_website, google_link, google_place_uri, public_listing_status
on public.activities
for each row
execute function public.record_admin_activity_curation();
