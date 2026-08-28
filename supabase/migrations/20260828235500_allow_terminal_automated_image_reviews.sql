-- A completed model pass can legitimately have no eligible candidate. Keep a
-- terminal audit row for those listings instead of leaving them looking unrun.
alter table public.activity_image_automated_reviews
  alter column candidate_index drop not null;

alter table public.activity_image_automated_reviews
  drop constraint if exists activity_image_automated_reviews_candidate_index_check;

alter table public.activity_image_automated_reviews
  add constraint activity_image_automated_reviews_candidate_index_check
    check (candidate_index is null or candidate_index between 0 and 19);
