-- Model proposals are deliberately isolated from activities and card images.
create table if not exists public.activity_image_model_proposals (
  batch_id text not null check (batch_id ~ '^[a-z0-9-]{1,80}$'),
  activity_id uuid not null references public.activities(activity_id),
  activity_snapshot jsonb not null,
  model_version text not null,
  status text not null check (status in ('proposed','no_candidate','partial_sources','error')),
  selected_image jsonb,
  alternatives jsonb not null default '[]'::jsonb check (jsonb_typeof(alternatives) = 'array'),
  candidate_count integer not null default 0 check (candidate_count >= 0),
  assessed_count integer not null default 0 check (assessed_count >= 0),
  source_gaps jsonb not null default '[]'::jsonb check (jsonb_typeof(source_gaps) = 'array'),
  failure_reason text,
  proposal_hash text not null check (proposal_hash ~ '^[a-f0-9]{64}$'),
  decision text not null default 'pending' check (decision in ('pending','approved','rejected','unsure')),
  chosen_image jsonb,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (batch_id, activity_id),
  check ((status = 'proposed' and selected_image is not null) or (status <> 'proposed' and selected_image is null))
);
create index if not exists activity_image_model_proposals_queue_idx
  on public.activity_image_model_proposals (batch_id, decision, activity_id);
alter table public.activity_image_model_proposals enable row level security;
revoke all on public.activity_image_model_proposals from public, anon, authenticated;
grant all on public.activity_image_model_proposals to service_role;
comment on table public.activity_image_model_proposals is
  'Review-only image proposals. Never changes activities or live card images.';

create or replace view public.activity_image_model_proposal_queue with (security_invoker = true) as
select batch_id, activity_id, status, candidate_count, decision, proposal_hash,
  jsonb_build_object('activity_name',activity_snapshot->>'activity_name',
    'category',activity_snapshot->>'category',
    'public_listing_status',activity_snapshot->>'public_listing_status',
    'address',activity_snapshot->>'address') as activity_snapshot,
  case when selected_image is null then null else jsonb_build_object('image_url',selected_image->>'image_url') end as selected_image,
  case when chosen_image is null then null else jsonb_build_object('image_url',chosen_image->>'image_url') end as chosen_image
from public.activity_image_model_proposals;
revoke all on public.activity_image_model_proposal_queue from public, anon, authenticated;
grant select on public.activity_image_model_proposal_queue to service_role;
