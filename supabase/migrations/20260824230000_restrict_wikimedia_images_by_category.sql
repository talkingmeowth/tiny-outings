-- Wikimedia imagery is only appropriate for place-led categories where a
-- public archival photograph reliably represents the outing. Remove existing
-- Wikimedia-backed card images elsewhere and prevent future direct writes.

update public.activity_image_llm_reviews as review
set application_status = 'rejected',
    selected_candidate_index = null,
    selected_source_url = null,
    selection_reason = concat_ws(' ', nullif(trim(review.selection_reason), ''),
      'Rejected by policy: Wikimedia images are not allowed for this activity category.'),
    metadata = coalesce(review.metadata, '{}'::jsonb)
      || jsonb_build_object('wikimedia_category_policy', 'rejected')
from public.activities as activity
where activity.activity_id = review.activity_id
  and trim(regexp_replace(replace(lower(coalesce(activity.category, '')), '&', 'and'), '[^a-z0-9]+', ' ', 'g'))
    not in ('parks and outdoor play', 'museums and culture', 'family activities')
  and coalesce(review.selected_source_url, '') ~* '(wikimedia(?:\.org| commons)|wikipedia(?:\.org)?)';

update public.activities
set admin_cover_image_url = case
      when coalesce(admin_cover_image_url, '') ~* '(wikimedia\.org|wikipedia\.org)' then null
      else admin_cover_image_url
    end,
    user_image_url = case
      when coalesce(user_image_url, '') ~* '(wikimedia\.org|wikipedia\.org)' then null
      else user_image_url
    end,
    scraped_image_url = case
      when coalesce(scraped_image_url, '') ~* '(wikimedia\.org|wikipedia\.org)'
        or coalesce(image_source_url, '') ~* '(wikimedia(?:\.org| commons)|wikipedia(?:\.org)?)' then null
      else scraped_image_url
    end,
    organiser_website_downloaded_image = case
      when coalesce(organiser_website_downloaded_image, '') ~* '(wikimedia\.org|wikipedia\.org)' then null
      else organiser_website_downloaded_image
    end,
    website_downloaded_image = case
      when coalesce(website_downloaded_image, '') ~* '(wikimedia\.org|wikipedia\.org)' then null
      else website_downloaded_image
    end,
    wikimedia_image_url = null,
    website_image_url = case
      when coalesce(website_image_url, '') ~* '(wikimedia\.org|wikipedia\.org)' then null
      else website_image_url
    end,
    listing_image_url = case
      when coalesce(listing_image_url, '') ~* '(wikimedia\.org|wikipedia\.org)' then null
      else listing_image_url
    end,
    image_url = case
      when coalesce(image_url, '') ~* '(wikimedia\.org|wikipedia\.org)' then null
      else image_url
    end,
    serpapi_image_selection_reason = case
      when coalesce(image_source_url, '') ~* '(wikimedia(?:\.org| commons)|wikipedia(?:\.org)?)'
        then 'Rejected by policy: Wikimedia images are not allowed for this activity category.'
      else serpapi_image_selection_reason
    end,
    serpapi_image_selection_confidence = case
      when coalesce(image_source_url, '') ~* '(wikimedia(?:\.org| commons)|wikipedia(?:\.org)?)' then null
      else serpapi_image_selection_confidence
    end,
    serpapi_image_vision_status = case
      when coalesce(image_source_url, '') ~* '(wikimedia(?:\.org| commons)|wikipedia(?:\.org)?)' then 'rejected'
      else serpapi_image_vision_status
    end,
    serpapi_image_vision_candidate_index = case
      when coalesce(image_source_url, '') ~* '(wikimedia(?:\.org| commons)|wikipedia(?:\.org)?)' then null
      else serpapi_image_vision_candidate_index
    end,
    serpapi_image_vision_reason = case
      when coalesce(image_source_url, '') ~* '(wikimedia(?:\.org| commons)|wikipedia(?:\.org)?)'
        then 'Rejected by policy: Wikimedia images are not allowed for this activity category.'
      else serpapi_image_vision_reason
    end,
    image_source_url = case
      when coalesce(image_source_url, '') ~* '(wikimedia(?:\.org| commons)|wikipedia(?:\.org)?)' then null
      else image_source_url
    end,
    updated_at = now()
where trim(regexp_replace(replace(lower(coalesce(category, '')), '&', 'and'), '[^a-z0-9]+', ' ', 'g'))
    not in ('parks and outdoor play', 'museums and culture', 'family activities')
  and (
    nullif(trim(wikimedia_image_url), '') is not null
    or concat_ws(' ',
      admin_cover_image_url,
      user_image_url,
      scraped_image_url,
      organiser_website_downloaded_image,
      website_downloaded_image,
      website_image_url,
      listing_image_url,
      image_url,
      image_source_url
    ) ~* '(wikimedia(?:\.org| commons)|wikipedia(?:\.org)?)'
  );

alter table public.activities
  drop constraint if exists activities_wikimedia_category_policy_check,
  add constraint activities_wikimedia_category_policy_check check (
    trim(regexp_replace(replace(lower(coalesce(category, '')), '&', 'and'), '[^a-z0-9]+', ' ', 'g'))
      in ('parks and outdoor play', 'museums and culture', 'family activities')
    or (
      nullif(trim(wikimedia_image_url), '') is null
      and concat_ws(' ',
        admin_cover_image_url,
        user_image_url,
        scraped_image_url,
        organiser_website_downloaded_image,
        website_downloaded_image,
        website_image_url,
        listing_image_url,
        image_url,
        image_source_url
      ) !~* '(wikimedia(?:\.org| commons)|wikipedia(?:\.org)?)'
    )
  );

comment on constraint activities_wikimedia_category_policy_check on public.activities is
  'Wikimedia images are permitted only for Parks & outdoor play, Museums & culture, and Family activities.';
