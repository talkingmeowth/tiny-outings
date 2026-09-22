-- Keep the desktop review queue cheap to load and make approval-time image
-- persistence reusable. The queue view now excludes archived/stale rows in
-- one query instead of requiring an additional activities lookup per page.

create or replace view public.activity_image_model_proposal_queue with (security_invoker = true) as
select proposal.batch_id, proposal.activity_id, proposal.status,
  proposal.candidate_count, proposal.decision, proposal.proposal_hash,
  jsonb_build_object(
    'activity_name', proposal.activity_snapshot->>'activity_name',
    'category', proposal.activity_snapshot->>'category',
    'public_listing_status', activity.public_listing_status,
    'address', proposal.activity_snapshot->>'address'
  ) as activity_snapshot,
  case when proposal.selected_image is null then null
    else jsonb_build_object('image_url', proposal.selected_image->>'image_url') end as selected_image,
  case when proposal.chosen_image is null then null
    else jsonb_build_object('image_url', proposal.chosen_image->>'image_url') end as chosen_image
from public.activity_image_model_proposals proposal
join public.activities activity using (activity_id)
where activity.archive = false
  and activity.public_listing_status in ('draft', 'published');

revoke all on public.activity_image_model_proposal_queue from public, anon, authenticated;
grant select on public.activity_image_model_proposal_queue to service_role;

create index if not exists activity_image_model_proposals_created_at_idx
  on public.activity_image_model_proposals (created_at desc);

create table if not exists public.activity_image_review_asset_cache (
  original_url text primary key check (original_url ~* '^https?://[^[:space:]]+$'),
  stored_url text not null check (stored_url ~* '^https?://[^[:space:]]+$'),
  storage_path text not null,
  width integer,
  height integer,
  mime_type text,
  stored_at timestamptz not null default now()
);

alter table public.activity_image_review_asset_cache enable row level security;
revoke all on public.activity_image_review_asset_cache from public, anon, authenticated;
grant all on public.activity_image_review_asset_cache to service_role;

comment on table public.activity_image_review_asset_cache is
  'Durable copies prepared for desktop model-image review. Never changes a live card by itself.';
