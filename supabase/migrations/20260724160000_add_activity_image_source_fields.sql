alter table public.activities
  add column if not exists website_image_url text,
  add column if not exists listing_image_url text,
  add column if not exists wikimedia_image_url text;

comment on column public.activities.website_image_url is
  'Representative image sourced from the organiser or official activity website.';

comment on column public.activities.listing_image_url is
  'Representative image sourced from an activity listing or directory page.';

comment on column public.activities.wikimedia_image_url is
  'Representative image found through Wikimedia Commons for a credibly matched activity or venue.';

-- Preserve provenance for older image_url values only when the recorded source
-- clearly identifies the listing or official/organiser website.
with image_origins as (
  select
    activity_id,
    image_url,
    nullif(regexp_replace(lower(split_part(coalesce(image_source_url, ''), '/', 3)), '^www\\.', ''), '') as source_host,
    nullif(regexp_replace(lower(split_part(coalesce(source_url, ''), '/', 3)), '^www\\.', ''), '') as listing_host,
    nullif(regexp_replace(lower(split_part(coalesce(website, ''), '/', 3)), '^www\\.', ''), '') as website_host,
    nullif(regexp_replace(lower(split_part(coalesce(organiser_website, ''), '/', 3)), '^www\\.', ''), '') as organiser_host
  from public.activities
  where nullif(btrim(image_url), '') is not null
)
update public.activities as activity
set
  listing_image_url = coalesce(
    activity.listing_image_url,
    case when origins.source_host = origins.listing_host then origins.image_url end
  ),
  website_image_url = coalesce(
    activity.website_image_url,
    case
      when origins.source_host = origins.website_host
        or origins.source_host = origins.organiser_host
      then origins.image_url
    end
  )
from image_origins as origins
where activity.activity_id = origins.activity_id
  and (
    origins.source_host = origins.listing_host
    or origins.source_host = origins.website_host
    or origins.source_host = origins.organiser_host
  );
