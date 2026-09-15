begin;
create table if not exists public.image_training_batches (
  batch_id text primary key check (batch_id ~ '^[a-z0-9-]{1,80}$'),
  title text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists public.image_training_cases (
  case_id uuid primary key default gen_random_uuid(),
  batch_id text not null references public.image_training_batches(batch_id),
  activity_id uuid not null references public.activities(activity_id),
  sequence integer not null,
  dataset_split text not null check (dataset_split in ('development', 'calibration', 'holdout')),
  evaluation_group_key text not null,
  selection_reason text not null,
  activity_snapshot jsonb not null,
  candidates jsonb not null check (jsonb_typeof(candidates) = 'array'),
  candidate_set_hash text not null,
  created_at timestamptz not null default now(),
  unique (batch_id, activity_id), unique (batch_id, sequence)
);
create table if not exists public.image_training_reviews (
  review_id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.image_training_cases(case_id),
  reviewer_id uuid not null references auth.users(id),
  request_id uuid not null unique,
  candidate_set_hash text not null,
  labels jsonb not null check (jsonb_typeof(labels) = 'array'),
  preferred_candidate_id text,
  outcome text not null check (outcome in ('selected', 'none_suitable', 'needs_candidates', 'cannot_verify')),
  notes text not null default '',
  submitted_at timestamptz not null default now()
);
create index if not exists image_training_reviews_case_time_idx on public.image_training_reviews(case_id, submitted_at desc, review_id desc);
alter table public.image_training_batches enable row level security;
alter table public.image_training_cases enable row level security;
alter table public.image_training_reviews enable row level security;
revoke all on public.image_training_batches, public.image_training_cases, public.image_training_reviews from public, anon, authenticated;
grant all on public.image_training_batches, public.image_training_cases, public.image_training_reviews to service_role;

create or replace view public.image_training_case_progress with (security_invoker = true) as
select c.case_id, c.batch_id, c.activity_id, c.sequence, c.dataset_split,
  c.activity_snapshot ->> 'activity_name' as activity_name,
  c.activity_snapshot ->> 'category' as category,
  c.activity_snapshot ->> 'address' as address,
  jsonb_array_length(c.candidates) as candidate_count,
  r.review_id, r.outcome, r.submitted_at,
  case when r.outcome in ('selected', 'none_suitable') then 'completed'
    when r.review_id is not null then 'deferred' else 'pending' end as review_status
from public.image_training_cases c
left join lateral (select * from public.image_training_reviews r where r.case_id = c.case_id
  and r.candidate_set_hash = c.candidate_set_hash
  order by r.submitted_at desc, r.review_id desc limit 1) r on true;

-- All explicit labels remain available for evaluation, including uncertainty
-- and failures. Unlabelled candidates never become negative examples.
create or replace view public.image_training_labelled_examples with (security_invoker = true) as
select c.case_id, c.activity_id, c.batch_id, c.dataset_split, c.evaluation_group_key, c.activity_snapshot,
  r.review_id, r.reviewer_id, r.submitted_at, r.outcome,
  image.value as candidate, label.value ->> 'label' as label,
  label.value ->> 'reason' as reason,
  (r.preferred_candidate_id = (image.value ->> 'candidate_id')) as is_preferred,
  c.candidate_set_hash
from public.image_training_cases c
join lateral (select * from public.image_training_reviews r where r.case_id = c.case_id
  and r.candidate_set_hash = c.candidate_set_hash order by r.submitted_at desc, r.review_id desc limit 1) r on true
cross join lateral jsonb_array_elements(r.labels) label(value)
join lateral jsonb_array_elements(c.candidates) image(value)
  on image.value ->> 'candidate_id' = label.value ->> 'candidate_id';

-- Training callers use this view. Calibration/holdout answers cannot leak into it.
create or replace view public.image_training_development_examples with (security_invoker = true) as
select e.* from public.image_training_labelled_examples e
where dataset_split = 'development' and label in ('acceptable', 'unsuitable')
  and not exists (select 1 from public.image_training_cases held
    where held.evaluation_group_key = e.evaluation_group_key and held.dataset_split in ('calibration','holdout'));
revoke all on public.image_training_case_progress, public.image_training_labelled_examples, public.image_training_development_examples from public, anon, authenticated;
grant select on public.image_training_case_progress, public.image_training_labelled_examples, public.image_training_development_examples to service_role;

comment on table public.image_training_reviews is 'Append-only admin training labels. Does not publish listings or change displayed images.';
commit;
