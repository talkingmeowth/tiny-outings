-- Populate organiser websites only from non-marketplace provider sites.
-- Listing/source URLs remain in website and source_url.

update public.activities
set
  organiser_website = 'https://www.walthamforest.gov.uk/',
  updated_at = now()
where data_source = 'better_start_for_life'
  and organiser_website is null;

update public.activities
set
  organiser_website = website,
  updated_at = now()
where organiser_website is null
  and website is not null
  and website not ilike '%happity.co.uk%'
  and website not ilike '%eventbrite.%'
  and website not ilike '%feverup.com%'
  and website not ilike '%google.%'
  and website not ilike '%walthamforest.gov.uk%';
