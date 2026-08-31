-- Make image selection quality-gated and make a SerpAPI request a durable,
-- one-time enrichment event whose complete response can be reused locally.
begin;

alter table public.activities
  add column if not exists model_selected_confidence numeric(5,4),
  add column if not exists model_selected_at timestamptz,
  add column if not exists serpapi_image_search_attempted_at timestamptz,
  add column if not exists serpapi_image_search_status text,
  add column if not exists serpapi_image_search_failure_reason text,
  add column if not exists serpapi_image_raw_result_count integer,
  add column if not exists serpapi_image_search_metadata jsonb;

alter table public.activities
  drop constraint if exists activities_model_selected_confidence_check,
  add constraint activities_model_selected_confidence_check check (
    model_selected_confidence is null
    or model_selected_confidence between 0 and 1
  ),
  drop constraint if exists activities_serpapi_image_search_status_check,
  add constraint activities_serpapi_image_search_status_check check (
    serpapi_image_search_status is null
    or serpapi_image_search_status in (
      'in_progress',
      'completed',
      'no_results',
      'failed',
      'legacy_completed'
    )
  ),
  drop constraint if exists activities_serpapi_image_raw_result_count_check,
  add constraint activities_serpapi_image_raw_result_count_check check (
    serpapi_image_raw_result_count is null
    or serpapi_image_raw_result_count >= 0
  );

comment on column public.activities.model_selected_confidence is
  'Confidence recorded when model_selected_url was auto-applied. The card hierarchy requires at least 0.70.';
comment on column public.activities.serpapi_image_search_attempted_at is
  'When the one permitted paid SerpAPI image request was claimed. A non-null value prevents automatic repeats, including after ambiguous failures.';
comment on column public.activities.serpapi_image_search_status is
  'Durable outcome of the one-time SerpAPI image request.';
comment on column public.activities.serpapi_image_search_metadata is
  'Complete call-level SerpAPI response metadata, excluding images_results which are stored without filtering in serpapi_image_candidates.';
comment on column public.activities.serpapi_image_candidates is
  'Every Google Images result and all result metadata returned by the one permitted SerpAPI call. Filtering happens only during local selection.';

-- Preserve the confidence attached to existing model-selected images.
with latest_model_review as (
  select distinct on (activity_id)
    activity_id,
    confidence,
    auto_applied_at
  from public.activity_image_automated_reviews
  where nullif(trim(auto_applied_image_url), '') is not null
  order by activity_id, auto_applied_at desc nulls last, created_at desc
)
update public.activities as activity
set model_selected_confidence = review.confidence,
    model_selected_at = coalesce(review.auto_applied_at, activity.updated_at)
from latest_model_review as review
where review.activity_id = activity.activity_id
  and nullif(trim(activity.model_selected_url), '') is not null
  and activity.model_selected_confidence is null;

-- Historic completed searches count as already spent even where an older
-- workflow retained only the selected URL rather than the full candidate set.
update public.activities
set serpapi_image_search_attempted_at = coalesce(
      serpapi_image_search_attempted_at,
      serpapi_image_candidates_fetched_at,
      serpapi_image_checked_at
    ),
    serpapi_image_search_status = coalesce(
      serpapi_image_search_status,
      case
        when serpapi_image_candidates_fetched_at is not null
          and jsonb_typeof(serpapi_image_candidates) = 'array'
          and jsonb_array_length(serpapi_image_candidates) > 0 then 'completed'
        when serpapi_image_candidates_fetched_at is not null
          and jsonb_typeof(serpapi_image_candidates) = 'array'
          and jsonb_array_length(serpapi_image_candidates) = 0 then 'no_results'
        when serpapi_image_candidates_fetched_at is not null
          or serpapi_image_checked_at is not null then 'legacy_completed'
        else null
      end
    ),
    serpapi_image_raw_result_count = coalesce(
      serpapi_image_raw_result_count,
      case
        when serpapi_image_candidates_fetched_at is not null
          and jsonb_typeof(serpapi_image_candidates) = 'array'
          then jsonb_array_length(serpapi_image_candidates)
        else null
      end
    )
where serpapi_image_search_attempted_at is null
   or serpapi_image_search_status is null
   or serpapi_image_raw_result_count is null;

drop index if exists public.activities_serpapi_candidate_discovery_pending_idx;
create index activities_serpapi_candidate_discovery_pending_idx
  on public.activities (created_at, activity_id)
  where serpapi_image_search_attempted_at is null
    and archive = false;

commit;
