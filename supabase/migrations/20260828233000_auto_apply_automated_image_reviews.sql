-- A model recommendation may be applied to the card immediately while still
-- remaining in the desktop queue for a later human confirmation or correction.
alter table public.activity_image_automated_reviews
  drop constraint if exists activity_image_automated_reviews_status_check;

alter table public.activity_image_automated_reviews
  add constraint activity_image_automated_reviews_status_check
    check (status in ('pending', 'auto_applied', 'approved', 'corrected', 'rejected', 'superseded')),
  add column if not exists auto_applied_at timestamptz,
  add column if not exists auto_applied_image_url text,
  add column if not exists apply_failure_reason text,
  add column if not exists apply_attempted_at timestamptz;

comment on column public.activity_image_automated_reviews.auto_applied_at is
  'When the model-selected candidate was written to reviewed_image_url before human QA.';
comment on column public.activity_image_automated_reviews.apply_failure_reason is
  'Most recent download, validation, storage, or database failure while applying the recommendation.';

drop index if exists public.activity_image_automated_reviews_one_pending_idx;
create unique index activity_image_automated_reviews_one_open_idx
  on public.activity_image_automated_reviews (activity_id)
  where status in ('pending', 'auto_applied');

drop index if exists public.activity_image_automated_reviews_queue_idx;
create index activity_image_automated_reviews_queue_idx
  on public.activity_image_automated_reviews (status, confidence desc, created_at asc);
