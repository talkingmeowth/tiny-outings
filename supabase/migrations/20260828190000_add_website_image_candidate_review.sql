-- Official website images must be reviewed as a complete candidate set. The
-- previous downloader stored the first metadata-ranked image without vision,
-- which allowed weak hero graphics and low-quality assets onto activity cards.
alter table public.activities
  add column if not exists website_image_candidates jsonb not null default '[]'::jsonb,
  add column if not exists website_image_candidate_pages jsonb not null default '[]'::jsonb,
  add column if not exists website_image_candidates_fetched_at timestamptz,
  add column if not exists website_image_selected_at timestamptz,
  add column if not exists website_image_vision_reviewed_at timestamptz,
  add column if not exists website_image_vision_model text,
  add column if not exists website_image_vision_status text,
  add column if not exists website_image_vision_candidate_index integer,
  add column if not exists website_image_vision_reason text,
  add column if not exists website_image_vision_candidates_fetched_at timestamptz;

alter table public.activities
  drop constraint if exists activities_website_image_vision_status_check,
  add constraint activities_website_image_vision_status_check
    check (website_image_vision_status is null or website_image_vision_status in (
      'selected',
      'rejected',
      'selection_download_failed'
    )),
  drop constraint if exists activities_website_image_vision_candidate_index_check,
  add constraint activities_website_image_vision_candidate_index_check
    check (website_image_vision_candidate_index is null or website_image_vision_candidate_index >= 0);

comment on column public.activities.website_image_candidates is
  'All unique non-utility images discovered on the activity, listing, and organiser website pages before visual review.';
comment on column public.activities.website_image_candidates_fetched_at is
  'Revision timestamp for the stored official-website image candidate set.';
comment on column public.activities.website_image_selected_at is
  'When Codex vision selected and stored an official-website image.';
comment on column public.activities.website_image_vision_candidates_fetched_at is
  'Exact official-website candidate revision reviewed by Codex vision.';

create table if not exists public.activity_website_image_llm_reviews (
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

comment on table public.activity_website_image_llm_reviews is
  'Append-only audit log of Codex multimodal reviews of complete official-website image candidate sets.';

alter table public.activity_website_image_llm_reviews enable row level security;
revoke all on public.activity_website_image_llm_reviews from anon, authenticated;
grant select, insert, update on public.activity_website_image_llm_reviews to service_role;
grant usage, select on sequence public.activity_website_image_llm_reviews_review_id_seq to service_role;

create index if not exists activity_website_image_llm_reviews_activity_idx
  on public.activity_website_image_llm_reviews (activity_id, candidate_set_fetched_at desc);

create or replace view public.codex_website_image_review_queue
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

revoke all on public.codex_website_image_review_queue from anon, authenticated;
grant select on public.codex_website_image_review_queue to service_role;
