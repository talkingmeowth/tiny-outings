-- Keep the Add screen reviewable without hiding the normal submission form.
-- Community listings are drafts; importer activity is already ingested, but
-- every new record and material importer update is logged for admin review.

create table if not exists public.activity_review_queue (
  review_queue_id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(activity_id) on delete cascade,
  queue_type text not null check (queue_type in ('user_submission', 'import_new', 'import_change')),
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed')),
  summary text not null,
  changes jsonb not null default '{}'::jsonb,
  source_name text,
  data_source text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid references auth.users(id) on delete set null
);

create index if not exists activity_review_queue_pending_idx
  on public.activity_review_queue(status, created_at asc)
  where status = 'pending';

create unique index if not exists activity_review_queue_pending_activity_type_idx
  on public.activity_review_queue(activity_id, queue_type)
  where status = 'pending';

alter table public.activity_review_queue enable row level security;

drop policy if exists "Admins can read activity review queue" on public.activity_review_queue;
create policy "Admins can read activity review queue"
on public.activity_review_queue
for select
using (public.is_tiny_outings_admin());

drop policy if exists "Admins can resolve activity review queue" on public.activity_review_queue;
create policy "Admins can resolve activity review queue"
on public.activity_review_queue
for update
using (public.is_tiny_outings_admin())
with check (public.is_tiny_outings_admin());

create or replace function public.enqueue_activity_review(
  target_activity_id uuid,
  target_queue_type text,
  target_summary text,
  target_changes jsonb,
  target_source_name text,
  target_data_source text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_review_queue (
    activity_id,
    queue_type,
    summary,
    changes,
    source_name,
    data_source
  ) values (
    target_activity_id,
    target_queue_type,
    target_summary,
    coalesce(target_changes, '{}'::jsonb),
    target_source_name,
    target_data_source
  )
  on conflict (activity_id, queue_type) where status = 'pending'
  do update set
    summary = excluded.summary,
    changes = excluded.changes,
    source_name = excluded.source_name,
    data_source = excluded.data_source,
    created_at = now();
end;
$$;

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
    elsif not public.is_tiny_outings_admin() then
      perform public.enqueue_activity_review(
        new.activity_id,
        'import_new',
        format('New importer listing from %s', coalesce(new.source_name, new.data_source, 'an importer')),
        jsonb_build_object('imported', true),
        new.source_name,
        new.data_source
      );
    end if;
    return new;
  end if;

  -- Administrator edits are already captured as curation feedback. Draft
  -- submissions remain in their own queue until an admin publishes or archives.
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
      format('Importer update from %s', coalesce(new.source_name, new.data_source, 'an importer')),
      changed_values,
      new.source_name,
      new.data_source
    );
  end if;

  return new;
end;
$$;

drop trigger if exists capture_activity_review_queue on public.activities;
create trigger capture_activity_review_queue
after insert or update of
  activity_name, address, category, start_time, end_time, website,
  organiser_website, google_link, google_place_uri, description, card_summary,
  cost, age_suitability, lat, long, available_dates, available_days_of_week,
  public_listing_status, archive, admin_cover_image_url, user_image_url,
  scraped_image_url, website_image_url, listing_image_url, wikimedia_image_url,
  image_url
on public.activities
for each row
execute function public.capture_activity_review_queue();

-- Surface submissions already waiting for review when the queue goes live.
insert into public.activity_review_queue (
  activity_id,
  queue_type,
  summary,
  changes,
  source_name,
  data_source,
  created_at
)
select
  activity_id,
  'user_submission',
  'New user-submitted activity',
  jsonb_build_object('submission', true),
  source_name,
  data_source,
  created_at
from public.activities
where public_listing_status = 'draft'
  and archive = false
on conflict (activity_id, queue_type) where status = 'pending'
do nothing;

-- This internal account is used only for end-to-end admin regression testing.
-- The app recognises it only in local development builds.
create or replace function public.is_tiny_outings_admin()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in (
    'talkingmeowth06@gmail.com',
    'talkingmeowtho6@gmail.com',
    'benfielden@gmail.com',
    'tinyoutings-qa-admin@tinyoutings.test'
  );
$$;
