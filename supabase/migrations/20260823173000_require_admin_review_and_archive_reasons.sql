-- New listings from importers and parents are reviewed before appearing in
-- the directory. Existing published importer records may still be refreshed,
-- while a deliberate archive can never be revived by an automated upsert.
alter table public.activities
  add column if not exists archive_reason text,
  add column if not exists archived_at timestamptz;

comment on column public.activities.archive_reason is
  'Why a listing was archived, such as expired dates, permanently closed, unsuitable, duplicate, or an admin decision.';

comment on column public.activities.archived_at is
  'When the listing was archived.';

create or replace function public.default_new_imports_to_draft()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- User submissions already set submitted_by_user_id. Source-backed rows
  -- without a submitting parent come from an importer and must be reviewed.
  if new.submitted_by_user_id is null
     and nullif(trim(coalesce(new.source_name, '')), '') is not null
     and coalesce(new.public_listing_status, 'draft') <> 'archived' then
    new.public_listing_status = 'draft';
    new.archive = false;
  end if;
  return new;
end;
$$;

drop trigger if exists default_new_imports_to_draft on public.activities;
create trigger default_new_imports_to_draft
before insert on public.activities
for each row
execute function public.default_new_imports_to_draft();

create or replace function public.preserve_existing_import_listing_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- PostgreSQL runs BEFORE INSERT for an UPSERT's excluded row. The insert
  -- rule above therefore marks it draft; retain the status of a live existing
  -- record when an importer is only refreshing its information.
  if old.public_listing_status = 'published'
     and new.public_listing_status = 'draft'
     and new.submitted_by_user_id is null
     and nullif(trim(coalesce(new.source_name, '')), '') is not null then
    new.public_listing_status = 'published';
  end if;
  return new;
end;
$$;

drop trigger if exists preserve_existing_import_listing_status on public.activities;
create trigger preserve_existing_import_listing_status
before update on public.activities
for each row
execute function public.preserve_existing_import_listing_status();

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
  is_importer boolean;
begin
  is_importer := new.submitted_by_user_id is null
    and nullif(trim(coalesce(new.source_name, '')), '') is not null;

  if tg_op = 'INSERT' then
    if new.public_listing_status = 'draft' then
      perform public.enqueue_activity_review(
        new.activity_id,
        case when is_importer then 'import_new' else 'user_submission' end,
        case
          when is_importer then format('New importer listing from %s', coalesce(new.source_name, new.data_source, 'an importer'))
          else 'New user-submitted activity'
        end,
        case when is_importer then jsonb_build_object('imported', true) else jsonb_build_object('submission', true) end,
        new.source_name,
        new.data_source
      );
    end if;
    return new;
  end if;

  -- An admin correction is deliberately reviewed in the app. A draft already
  -- has its import_new or user_submission queue item and does not need a
  -- second item for every enrichment field populated before approval.
  if public.is_tiny_outings_admin()
     or old.public_listing_status = 'draft'
     or new.public_listing_status = 'draft'
     or not is_importer then
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
    'archive_reason', old.archive_reason,
    'cover_image', coalesce(old.admin_cover_image_url, old.user_image_url, old.scraped_image_url, old.organiser_website_downloaded_image, old.website_downloaded_image, old.wikimedia_image_url, old.website_image_url, old.listing_image_url, old.image_url)
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
    'archive_reason', new.archive_reason,
    'cover_image', coalesce(new.admin_cover_image_url, new.user_image_url, new.scraped_image_url, new.organiser_website_downloaded_image, new.website_downloaded_image, new.wikimedia_image_url, new.website_image_url, new.listing_image_url, new.image_url)
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
      format('Importer update from %s', coalesce(new.source_name, new.data_source, 'an importer')),
      changed_values,
      new.source_name,
      new.data_source
    );
  end if;

  return new;
end;
$$;

create or replace function public.archive_tiny_outings_activity(target_activity_id uuid)
returns public.activities
language plpgsql
security definer
set search_path = public
as $$
declare
  archived_activity public.activities;
begin
  if not public.is_tiny_outings_admin() then
    raise exception 'Only Tiny Outings administrators can archive listings';
  end if;

  update public.activities
  set archive = true,
      public_listing_status = 'archived',
      archive_reason = coalesce(nullif(archive_reason, ''), 'Archived by an administrator'),
      archived_at = coalesce(archived_at, now()),
      updated_at = now()
  where activity_id = target_activity_id
  returning * into archived_activity;

  if not found then
    raise exception 'Listing not found';
  end if;

  return archived_activity;
end;
$$;
