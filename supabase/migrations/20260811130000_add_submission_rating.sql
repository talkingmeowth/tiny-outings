-- Keep a parent-provided rating separate from imported Google and app ratings
-- while a new activity is waiting for administrator review.
alter table public.activities
  add column if not exists submission_rating numeric
  check (submission_rating is null or (submission_rating >= 1 and submission_rating <= 5));
