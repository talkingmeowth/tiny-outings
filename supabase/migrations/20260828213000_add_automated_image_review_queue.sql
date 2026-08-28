-- Automated image choices are deliberately staged outside the activity image
-- hierarchy. An administrator must approve or correct each proposal before the
-- downloaded image is written to activities.reviewed_image_url.
create table if not exists public.activity_image_automated_reviews (
  automated_review_id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(activity_id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'corrected', 'rejected', 'superseded')),
  source_queue text not null
    check (source_queue in ('missing_published', 'unsuitable_audit', 'both')),
  candidate_index integer not null check (candidate_index between 0 and 19),
  candidate jsonb not null check (jsonb_typeof(candidate) = 'object'),
  candidate_set_searched_at timestamptz,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  reason text not null,
  model_name text not null,
  model_version text not null,
  training_review_count integer not null check (training_review_count > 0),
  model_metrics jsonb not null default '{}'::jsonb,
  feature_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid references auth.users(id) on delete set null,
  reviewed_candidate_index integer check (reviewed_candidate_index between 0 and 19),
  reviewed_image_url text
);

create unique index if not exists activity_image_automated_reviews_one_pending_idx
  on public.activity_image_automated_reviews (activity_id)
  where status = 'pending';

create index if not exists activity_image_automated_reviews_queue_idx
  on public.activity_image_automated_reviews (status, confidence desc, created_at asc);

comment on table public.activity_image_automated_reviews is
  'Staged candidate choices learned from manual desktop image reviews. Pending rows never affect card images until an administrator approves or corrects them.';

alter table public.activity_image_automated_reviews enable row level security;
revoke all on public.activity_image_automated_reviews from anon, authenticated;
grant select, insert, update, delete on public.activity_image_automated_reviews to authenticated;
grant all on public.activity_image_automated_reviews to service_role;

drop policy if exists "Admins can manage automated image reviews" on public.activity_image_automated_reviews;
create policy "Admins can manage automated image reviews"
on public.activity_image_automated_reviews
for all
using (public.is_tiny_outings_admin())
with check (public.is_tiny_outings_admin());
