begin;

alter table public.activities
  add column if not exists source_listing_checked_at timestamptz,
  add column if not exists source_listing_last_seen_at timestamptz,
  add column if not exists source_listing_check_status text,
  add column if not exists source_listing_check_detail text,
  add column if not exists google_place_checked_at timestamptz,
  add column if not exists google_business_status text,
  add column if not exists google_place_check_status text;

create index if not exists activities_source_listing_checked_at_idx
  on public.activities (source_listing_checked_at)
  where archive = false and public_listing_status in ('published', 'draft');

create index if not exists activities_google_place_checked_at_idx
  on public.activities (google_place_checked_at)
  where archive = false and public_listing_status in ('published', 'draft');

comment on column public.activities.source_listing_checked_at is
  'Most recent attempt to validate the individual source listing URL.';
comment on column public.activities.source_listing_last_seen_at is
  'Most recent successful confirmation that the individual source listing remained active.';
comment on column public.activities.source_listing_check_status is
  'Latest source validation result: active, updated, stale, unreachable, or unsupported.';
comment on column public.activities.source_listing_check_detail is
  'Short audit explanation for the latest source listing validation result.';
comment on column public.activities.google_place_checked_at is
  'Most recent Google Places identity and business-status validation attempt.';
comment on column public.activities.google_business_status is
  'Latest businessStatus returned for the stored, identity-matched Google Place.';
comment on column public.activities.google_place_check_status is
  'Latest Google Places validation action or unresolved state.';

commit;
