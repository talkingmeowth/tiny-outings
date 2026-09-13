drop view if exists public.codex_image_review_queue;

create view public.codex_image_review_queue
with (security_invoker = true)
as
select
  a.activity_id,
  a.activity_name,
  a.address,
  a.postcode,
  a.borough,
  a.category,
  a.description,
  a.google_summary,
  a.google_primary_type,
  a.google_place_id,
  a.google_place_uri,
  a.google_link,
  a.source_name,
  a.source_url,
  a.website,
  a.organiser_website,
  a.serpapi_image_search_query,
  a.serpapi_image_search_ward,
  a.serpapi_image_candidates,
  a.serpapi_image_candidates_fetched_at
from public.activities a
where coalesce(a.archive, false) = false
  and a.public_listing_status in ('draft', 'published')
  and a.serpapi_image_candidates_fetched_at is not null
  and jsonb_array_length(coalesce(a.serpapi_image_candidates, '[]'::jsonb)) > 0
  and not exists (
    select 1
    from public.activity_image_llm_reviews r
    where r.activity_id = a.activity_id
      and r.provider = 'codex'
      and r.candidate_set_fetched_at = a.serpapi_image_candidates_fetched_at
  );

drop view if exists public.codex_website_image_review_queue;

create view public.codex_website_image_review_queue
with (security_invoker = true)
as
select
  a.activity_id,
  a.activity_name,
  a.address,
  a.postcode,
  a.borough,
  a.category,
  a.description,
  a.google_summary,
  a.google_primary_type,
  a.google_place_id,
  a.google_place_uri,
  a.google_link,
  a.source_name,
  a.source_url,
  a.website,
  a.organiser_website,
  null::text as serpapi_image_search_query,
  a.borough as serpapi_image_search_ward,
  a.website_image_candidates as serpapi_image_candidates,
  a.website_image_candidates_fetched_at as serpapi_image_candidates_fetched_at
from public.activities a
where coalesce(a.archive, false) = false
  and a.public_listing_status in ('draft', 'published')
  and a.website_image_candidates_fetched_at is not null
  and jsonb_array_length(coalesce(a.website_image_candidates, '[]'::jsonb)) > 0
  and not exists (
    select 1
    from public.activity_website_image_llm_reviews r
    where r.activity_id = a.activity_id
      and r.provider = 'codex'
      and r.candidate_set_fetched_at = a.website_image_candidates_fetched_at
  );

revoke all on public.codex_image_review_queue from anon, authenticated;
grant select on public.codex_image_review_queue to service_role;
revoke all on public.codex_website_image_review_queue from anon, authenticated;
grant select on public.codex_website_image_review_queue to service_role;
