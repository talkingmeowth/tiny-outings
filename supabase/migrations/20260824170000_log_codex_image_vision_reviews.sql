-- Keep a durable, queryable audit trail for image choices made by Codex
-- vision. A review is tied to the exact SerpAPI candidate-fetch timestamp so
-- a newly fetched candidate set is automatically eligible for a new review.
alter table public.activities
  add column if not exists serpapi_image_search_ward text,
  add column if not exists serpapi_image_vision_reviewed_at timestamptz,
  add column if not exists serpapi_image_vision_model text,
  add column if not exists serpapi_image_vision_status text,
  add column if not exists serpapi_image_vision_candidate_index integer,
  add column if not exists serpapi_image_vision_reason text,
  add column if not exists serpapi_image_vision_candidates_fetched_at timestamptz;

alter table public.activities
  drop constraint if exists activities_serpapi_image_vision_status_check,
  add constraint activities_serpapi_image_vision_status_check
    check (serpapi_image_vision_status is null or serpapi_image_vision_status in (
      'selected',
      'rejected',
      'selection_download_failed'
    )),
  drop constraint if exists activities_serpapi_image_vision_candidate_index_check,
  add constraint activities_serpapi_image_vision_candidate_index_check
    check (serpapi_image_vision_candidate_index is null or serpapi_image_vision_candidate_index >= 0);

comment on column public.activities.serpapi_image_search_ward is
  'London ward resolved for the SerpAPI image search, normally from the activity postcode.';
comment on column public.activities.serpapi_image_vision_reviewed_at is
  'When a multimodal Codex model reviewed the stored SerpAPI candidate set.';
comment on column public.activities.serpapi_image_vision_candidates_fetched_at is
  'Candidate-fetch timestamp reviewed by Codex; ties the latest decision to an exact candidate set.';

create table if not exists public.activity_image_llm_reviews (
  review_id bigint generated always as identity primary key,
  activity_id uuid not null references public.activities(activity_id) on delete cascade,
  candidate_set_fetched_at timestamptz not null,
  reviewed_at timestamptz not null default now(),
  provider text not null,
  model text not null,
  workflow_version text not null,
  decision text not null check (decision in ('selected', 'rejected')),
  application_status text not null check (application_status in (
    'selected',
    'rejected',
    'selection_download_failed'
  )),
  selected_candidate_index integer check (selected_candidate_index is null or selected_candidate_index >= 0),
  selection_reason text not null,
  selection_confidence numeric(5,4),
  candidate_count integer not null check (candidate_count > 0),
  selected_source_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (activity_id, candidate_set_fetched_at, provider, model, workflow_version)
);

comment on table public.activity_image_llm_reviews is
  'Append-only audit log of multimodal LLM reviews of stored SerpAPI image candidate sets.';

alter table public.activity_image_llm_reviews enable row level security;
revoke all on public.activity_image_llm_reviews from anon, authenticated;
grant select, insert, update on public.activity_image_llm_reviews to service_role;
grant usage, select on sequence public.activity_image_llm_reviews_review_id_seq to service_role;

create index if not exists activity_image_llm_reviews_activity_idx
  on public.activity_image_llm_reviews (activity_id, candidate_set_fetched_at desc);

-- Backfill the 20 cafe reviews already completed in Codex. Matching the
-- selected source URL back to the stored candidate recovers the zero-based
-- index for accepted images; rejected sets intentionally keep a null index.
with prior_codex_reviews as (
  select
    a.activity_id,
    a.serpapi_image_candidates_fetched_at as candidate_set_fetched_at,
    coalesce(a.serpapi_image_selected_at, a.updated_at, now()) as reviewed_at,
    case when nullif(trim(a.scraped_image_url), '') is null then 'rejected' else 'selected' end as decision,
    case when nullif(trim(a.scraped_image_url), '') is null then null else (
      select candidate.ordinality::integer - 1
      from jsonb_array_elements(a.serpapi_image_candidates) with ordinality as candidate(value, ordinality)
      where candidate.value ->> 'original' = a.image_source_url
      order by candidate.ordinality
      limit 1
    ) end as selected_candidate_index,
    a.serpapi_image_selection_reason as selection_reason,
    a.serpapi_image_selection_confidence as selection_confidence,
    jsonb_array_length(a.serpapi_image_candidates) as candidate_count,
    case when nullif(trim(a.scraped_image_url), '') is null then null else a.image_source_url end as selected_source_url
  from public.activities a
  where a.serpapi_image_candidates_fetched_at is not null
    and jsonb_array_length(a.serpapi_image_candidates) > 0
    and a.serpapi_image_selection_reason like 'Codex LLM visual review:%'
)
insert into public.activity_image_llm_reviews (
  activity_id,
  candidate_set_fetched_at,
  reviewed_at,
  provider,
  model,
  workflow_version,
  decision,
  application_status,
  selected_candidate_index,
  selection_reason,
  selection_confidence,
  candidate_count,
  selected_source_url,
  metadata
)
select
  activity_id,
  candidate_set_fetched_at,
  reviewed_at,
  'codex',
  'gpt-5.6-sol',
  'codex-visual-v1',
  decision,
  decision,
  selected_candidate_index,
  selection_reason,
  selection_confidence,
  candidate_count,
  selected_source_url,
  jsonb_build_object('backfilled', true, 'display_model', 'Codex 5.6 Sol')
from prior_codex_reviews
on conflict (activity_id, candidate_set_fetched_at, provider, model, workflow_version) do nothing;

update public.activities a
set serpapi_image_vision_reviewed_at = r.reviewed_at,
    serpapi_image_vision_model = r.model,
    serpapi_image_vision_status = r.application_status,
    serpapi_image_vision_candidate_index = r.selected_candidate_index,
    serpapi_image_vision_reason = r.selection_reason,
    serpapi_image_vision_candidates_fetched_at = r.candidate_set_fetched_at
from public.activity_image_llm_reviews r
where r.activity_id = a.activity_id
  and r.provider = 'codex'
  and r.candidate_set_fetched_at = a.serpapi_image_candidates_fetched_at
  and r.reviewed_at = (
    select max(latest.reviewed_at)
    from public.activity_image_llm_reviews latest
    where latest.activity_id = r.activity_id
      and latest.provider = 'codex'
      and latest.candidate_set_fetched_at = r.candidate_set_fetched_at
  );

create or replace view public.codex_image_review_queue
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

revoke all on public.codex_image_review_queue from anon, authenticated;
grant select on public.codex_image_review_queue to service_role;
