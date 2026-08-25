-- Administrators can remove a listing from active desktop image-review queues
-- without archiving or changing its publication state.
alter table public.activities
  add column if not exists image_review_ignored_at timestamptz,
  add column if not exists image_review_ignored_by_user_id uuid references auth.users(id) on delete set null;

comment on column public.activities.image_review_ignored_at is
  'When set, the listing appears only in the desktop image reviewer Ignored queue.';
comment on column public.activities.image_review_ignored_by_user_id is
  'Administrator who most recently ignored the listing in the desktop image reviewer.';

create index if not exists activities_image_review_ignored_idx
  on public.activities (image_review_ignored_at desc, activity_id)
  where archive = false and image_review_ignored_at is not null;
