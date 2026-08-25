-- Desktop image review keeps manual choices separate from automated audit
-- replacements and from the legacy SerpAPI enrichment fields.
alter table public.activities
  add column if not exists reviewed_image_url text,
  add column if not exists reviewed_image_source_url text,
  add column if not exists reviewed_image_original_url text,
  add column if not exists reviewed_image_selected_at timestamptz,
  add column if not exists reviewed_image_model text,
  add column if not exists reviewed_image_selected_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists codex_image_candidates jsonb not null default '[]'::jsonb,
  add column if not exists codex_image_search_query text,
  add column if not exists codex_image_searched_at timestamptz,
  add column if not exists codex_image_search_model text;

comment on column public.activities.reviewed_image_url is
  'App-owned Storage URL manually selected in the desktop image review tool.';
comment on column public.activities.reviewed_image_source_url is
  'Source webpage for the manually reviewed image, when the LLM search returned one.';
comment on column public.activities.reviewed_image_original_url is
  'Original remote image URL copied into reviewed_image_url.';
comment on column public.activities.codex_image_candidates is
  'Image candidates found and visually reviewed by Codex in the administrator chat. This field is independent of SerpAPI candidates and uses no runtime model API key.';

create index if not exists activities_image_review_missing_published_idx
  on public.activities (activity_id)
  where archive = false
    and public_listing_status = 'published'
    and reviewed_image_url is null;

create index if not exists activities_image_review_unsuitable_idx
  on public.activities (activity_id)
  where archive = false
    and audit_image_status in ('needs_replacement', 'no_replacement')
    and reviewed_image_url is null;

create table if not exists public.activity_image_manual_reviews (
  manual_review_id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(activity_id) on delete cascade,
  reviewed_image_url text not null,
  original_image_url text not null,
  source_page_url text,
  search_query text not null,
  candidate jsonb not null default '{}'::jsonb,
  model text not null,
  selected_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists activity_image_manual_reviews_activity_idx
  on public.activity_image_manual_reviews (activity_id, created_at desc);

alter table public.activity_image_manual_reviews enable row level security;
revoke all on public.activity_image_manual_reviews from anon, authenticated;
grant select on public.activity_image_manual_reviews to authenticated;
grant select, insert, update on public.activity_image_manual_reviews to service_role;

drop policy if exists "Admins can read manual image reviews" on public.activity_image_manual_reviews;
create policy "Admins can read manual image reviews"
on public.activity_image_manual_reviews
for select
using (public.is_tiny_outings_admin());

-- The desktop app requests candidate searches here. Codex in the administrator
-- chat claims pending rows, searches and reviews the images, writes the chosen
-- candidate set to activities.codex_image_candidates, then completes the row.
-- No OpenAI API key or SerpAPI call is made by the app or database.
create table if not exists public.codex_image_candidate_requests (
  candidate_request_id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(activity_id) on delete cascade,
  requested_query text not null check (length(trim(requested_query)) between 1 and 240),
  request_variant text not null default 'activity_location'
    check (request_variant in ('activity_location', 'provider_location', 'activity_only', 'custom')),
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
  requested_by_user_id uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  codex_model text,
  candidate_count integer check (candidate_count is null or candidate_count between 0 and 20),
  failure_reason text
);

create index if not exists codex_image_candidate_requests_queue_idx
  on public.codex_image_candidate_requests (status, requested_at asc);
create index if not exists codex_image_candidate_requests_activity_idx
  on public.codex_image_candidate_requests (activity_id, requested_at desc);
create unique index if not exists codex_image_candidate_requests_one_active_idx
  on public.codex_image_candidate_requests (activity_id)
  where status in ('pending', 'in_progress');

alter table public.codex_image_candidate_requests enable row level security;
revoke all on public.codex_image_candidate_requests from anon, authenticated;
grant select, insert, update, delete on public.codex_image_candidate_requests to authenticated;
grant all on public.codex_image_candidate_requests to service_role;

drop policy if exists "Admins can manage Codex candidate requests" on public.codex_image_candidate_requests;
create policy "Admins can manage Codex candidate requests"
on public.codex_image_candidate_requests
for all
using (public.is_tiny_outings_admin())
with check (public.is_tiny_outings_admin());

-- Manual reviewed images obey the same Wikimedia category restriction as every
-- other card-image source.
alter table public.activities
  drop constraint if exists activities_wikimedia_category_policy_check,
  add constraint activities_wikimedia_category_policy_check check (
    trim(regexp_replace(replace(lower(coalesce(category, '')), '&', 'and'), '[^a-z0-9]+', ' ', 'g'))
      in ('parks and outdoor play', 'museums and culture', 'family activities')
    or (
      nullif(trim(wikimedia_image_url), '') is null
      and concat_ws(' ',
        admin_cover_image_url,
        reviewed_image_url,
        reviewed_image_source_url,
        reviewed_image_original_url,
        audit_image_url,
        audit_image_source_url,
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
