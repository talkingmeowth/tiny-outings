-- Keep a stable, app-owned copy when an official page image cannot be served
-- reliably from its original host. The image downloader writes these fields
-- with the service role only; public clients can read the resulting URLs.
alter table public.activities
  add column if not exists website_downloaded_image text,
  add column if not exists organiser_website_downloaded_image text;

comment on column public.activities.website_downloaded_image is
  'Public Storage URL for a vetted image downloaded from the activity website or listing page.';

comment on column public.activities.organiser_website_downloaded_image is
  'Public Storage URL for a vetted image downloaded from the organiser official website.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'activity-images',
  'activity-images',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Ensure automated import updates do not create a moderation task while still
-- making the new image source visible in an audit if a community listing is
-- edited outside the importer pipeline.
create or replace function public.capture_activity_review_queue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_values jsonb;
  new_values jsonb;
  changed_values jsonb;
begin
  if tg_op = 'INSERT' then
    if new.public_listing_status = 'draft' then
      perform public.enqueue_activity_review(
        new.activity_id,
        'user_submission',
        'New user-submitted activity',
        jsonb_build_object('submission', true),
        new.source_name,
        new.data_source
      );
    end if;
    return new;
  end if;

  if nullif(trim(coalesce(new.source_name, '')), '') is not null then
    return new;
  end if;

  if public.is_tiny_outings_admin()
     or old.public_listing_status = 'draft'
     or new.public_listing_status = 'draft' then
    return new;
  end if;

  old_values := jsonb_build_object(
    'name', old.activity_name,
    'address', old.address,
    'category', old.category,
    'start_time', old.start_time,
    'end_time', old.end_time,
    'website', old.website,
    'organiser_website', old.organiser_website,
    'google_places_link', coalesce(old.google_place_uri, old.google_link),
    'description', old.description,
    'card_summary', old.card_summary,
    'price', old.cost,
    'age_suitability', old.age_suitability,
    'latitude', old.lat,
    'longitude', old.long,
    'availability_dates', old.available_dates,
    'availability_days', old.available_days_of_week,
    'status', old.public_listing_status,
    'archived', old.archive,
    'cover_image', coalesce(
      old.admin_cover_image_url,
      old.user_image_url,
      old.scraped_image_url,
      old.organiser_website_downloaded_image,
      old.website_downloaded_image,
      old.wikimedia_image_url,
      old.website_image_url,
      old.listing_image_url,
      old.image_url
    )
  );
  new_values := jsonb_build_object(
    'name', new.activity_name,
    'address', new.address,
    'category', new.category,
    'start_time', new.start_time,
    'end_time', new.end_time,
    'website', new.website,
    'organiser_website', new.organiser_website,
    'google_places_link', coalesce(new.google_place_uri, new.google_link),
    'description', new.description,
    'card_summary', new.card_summary,
    'price', new.cost,
    'age_suitability', new.age_suitability,
    'latitude', new.lat,
    'longitude', new.long,
    'availability_dates', new.available_dates,
    'availability_days', new.available_days_of_week,
    'status', new.public_listing_status,
    'archived', new.archive,
    'cover_image', coalesce(
      new.admin_cover_image_url,
      new.user_image_url,
      new.scraped_image_url,
      new.organiser_website_downloaded_image,
      new.website_downloaded_image,
      new.wikimedia_image_url,
      new.website_image_url,
      new.listing_image_url,
      new.image_url
    )
  );

  select coalesce(
    jsonb_object_agg(key, jsonb_build_object('before', old_values -> key, 'after', new_values -> key)),
    '{}'::jsonb
  ) into changed_values
  from jsonb_each(new_values) as fields(key, value)
  where old_values -> key is distinct from new_values -> key;

  if changed_values <> '{}'::jsonb then
    perform public.enqueue_activity_review(
      new.activity_id,
      'import_change',
      'Unattributed published activity changed',
      changed_values,
      new.source_name,
      new.data_source
    );
  end if;

  return new;
end;
$$;
