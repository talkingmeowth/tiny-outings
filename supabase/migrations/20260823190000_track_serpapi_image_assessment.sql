-- SerpAPI should assess each new activity once, even where an importer already
-- found an official image. This timestamp prevents recurring runs from paying
-- to re-search the same record after a successful or unsuccessful assessment.
alter table public.activities
  add column if not exists serpapi_image_checked_at timestamptz;

comment on column public.activities.serpapi_image_checked_at is
  'When the shared SerpAPI image job last assessed this activity. New records are assessed once even when another image source is already populated.';

-- Preserve the current image coverage without turning this migration into a
-- full historical SerpAPI refresh. Image-less existing records remain null and
-- are therefore picked up by the next shared enrichment run.
update public.activities
set serpapi_image_checked_at = coalesce(updated_at, now())
where serpapi_image_checked_at is null
  and coalesce(
    nullif(trim(admin_cover_image_url), ''),
    nullif(trim(user_image_url), ''),
    nullif(trim(scraped_image_url), ''),
    nullif(trim(organiser_website_downloaded_image), ''),
    nullif(trim(website_downloaded_image), ''),
    nullif(trim(wikimedia_image_url), ''),
    nullif(trim(website_image_url), ''),
    nullif(trim(listing_image_url), ''),
    nullif(trim(image_url), '')
  ) is not null;

create index if not exists activities_serpapi_image_pending_idx
  on public.activities (created_at, activity_id)
  where serpapi_image_checked_at is null
    and archive = false;
