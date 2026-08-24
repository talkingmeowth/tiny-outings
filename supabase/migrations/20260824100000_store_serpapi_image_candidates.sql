-- SerpAPI is a paid discovery source. Store the complete result set from one
-- successful search so image ranking can improve locally without re-querying.
alter table public.activities
  add column if not exists serpapi_image_candidates jsonb not null default '[]'::jsonb,
  add column if not exists serpapi_image_search_query text,
  add column if not exists serpapi_image_candidates_fetched_at timestamptz,
  add column if not exists serpapi_image_selected_at timestamptz,
  add column if not exists serpapi_image_selection_reason text,
  add column if not exists serpapi_image_selection_confidence numeric(5,4);

comment on column public.activities.serpapi_image_candidates is
  'Raw usable Google Images candidates returned by the one permitted SerpAPI discovery call for this listing.';
comment on column public.activities.serpapi_image_candidates_fetched_at is
  'Successful one-time SerpAPI candidate discovery timestamp. A non-null value prevents further paid discovery calls.';
comment on column public.activities.serpapi_image_selected_at is
  'When the local visual selection policy last chose a high-confidence candidate.';

-- Historic searches did not retain all candidates. Mark their cost as already
-- spent so this migration cannot make the importer re-run paid searches.
update public.activities
set serpapi_image_candidates_fetched_at = serpapi_image_checked_at
where serpapi_image_candidates_fetched_at is null
  and serpapi_image_checked_at is not null;

update public.activities
set serpapi_image_selected_at = coalesce(serpapi_image_selected_at, serpapi_image_checked_at),
    serpapi_image_selection_reason = coalesce(
      nullif(serpapi_image_selection_reason, ''),
      'Legacy SerpAPI selection retained without a stored candidate set.'
    )
where nullif(trim(scraped_image_url), '') is not null
  and serpapi_image_checked_at is not null;

create index if not exists activities_serpapi_candidate_discovery_pending_idx
  on public.activities (created_at, activity_id)
  where serpapi_image_candidates_fetched_at is null
    and archive = false;
