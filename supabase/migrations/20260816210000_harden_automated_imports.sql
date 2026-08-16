-- Automated directory refreshes publish verified importer records directly.
-- Community submissions remain drafts and continue through the admin queue.

create or replace function public.preserve_archived_activity_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- An importer may send archive = false in an UPSERT. A human archive is a
  -- deliberate moderation decision and must never be revived by a refresh.
  if old.archive is true or old.public_listing_status = 'archived' then
    new.archive = true;
    new.public_listing_status = 'archived';
  end if;
  return new;
end;
$$;

drop trigger if exists preserve_archived_activity_status on public.activities;
create trigger preserve_archived_activity_status
before update on public.activities
for each row
execute function public.preserve_archived_activity_status();

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
    -- Only parent-submitted drafts need a manual decision. Importers run
    -- through the automated quality pipeline before publication.
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

  -- Source-backed records are maintained by tiny-outings-update. Do not add
  -- routine refreshes to the admin review queue.
  if nullif(trim(coalesce(new.source_name, '')), '') is not null then
    return new;
  end if;

  -- Administrator edits are captured separately; draft submissions remain in
  -- their own queue until an administrator publishes or archives them.
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
    'cover_image', coalesce(old.admin_cover_image_url, old.user_image_url, old.scraped_image_url, old.website_image_url, old.listing_image_url, old.wikimedia_image_url, old.image_url)
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
    'cover_image', coalesce(new.admin_cover_image_url, new.user_image_url, new.scraped_image_url, new.website_image_url, new.listing_image_url, new.wikimedia_image_url, new.image_url)
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

-- Importer queue entries were useful during early setup. Automated quality
-- checks now replace that review step, so remove stale pending importer work.
update public.activity_review_queue
set status = 'dismissed',
    reviewed_at = now()
where status = 'pending'
  and queue_type in ('import_new', 'import_change');
