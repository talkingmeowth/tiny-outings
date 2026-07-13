with website_repairs (activity_id, website, google_place_uri) as (
  values
    ($$1a76b711-1373-4877-8b36-29ab5801373b$$::uuid, $$https://www.londonfieldsfitness.com/$$, $$https://maps.google.com/?cid=14851819592347585528&g_mp=CiVnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLkdldFBsYWNlEAIYBCAA$$),
    ($$7853f204-f1e2-4030-af5e-7a4ac62f831e$$::uuid, $$https://hackney-museum.hackney.gov.uk/$$, $$https://maps.google.com/?cid=438563270895334297&g_mp=CiVnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLkdldFBsYWNlEAIYBCAA$$)
)
update public.activities as activity
set
  website = website_repairs.website,
  google_place_uri = coalesce(website_repairs.google_place_uri, activity.google_place_uri),
  google_link = coalesce(website_repairs.google_place_uri, activity.google_link),
  updated_at = now()
from website_repairs
where activity.activity_id = website_repairs.activity_id;
