-- Google and Maps links belong in google_link/google_place_uri, never in the
-- Website or Organiser site buttons. Prefer an existing independent organiser
-- link when it can replace an accidental Maps website; otherwise clear it.
with normalised_links as (
  select
    activity_id,
    website,
    organiser_website,
    website ~* '^https?://((www\.)?(google\.(com|co\.uk))|maps\.google\.com|maps\.app\.goo\.gl)(/|$)' as website_is_google,
    organiser_website ~* '^https?://((www\.)?(google\.(com|co\.uk))|maps\.google\.com|maps\.app\.goo\.gl)(/|$)' as organiser_is_google
  from public.activities
)
update public.activities as activity
set
  website = case
    when links.website_is_google and coalesce(links.organiser_is_google, false) = false then links.organiser_website
    when links.website_is_google then null
    else activity.website
  end,
  organiser_website = case
    when links.organiser_is_google or links.website_is_google then null
    else activity.organiser_website
  end,
  updated_at = now()
from normalised_links as links
where activity.activity_id = links.activity_id
  and (coalesce(links.website_is_google, false) or coalesce(links.organiser_is_google, false));
