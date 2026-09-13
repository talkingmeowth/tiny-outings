-- Cross-source image review combines SerpAPI, website, organiser and stored
-- activity fields, so its stable candidate index is not limited to one
-- 20-result provider page.
alter table public.activity_image_automated_reviews
  drop constraint if exists activity_image_automated_reviews_candidate_index_check;

alter table public.activity_image_automated_reviews
  add constraint activity_image_automated_reviews_candidate_index_check
    check (candidate_index is null or candidate_index >= 0);

alter table public.activity_image_automated_reviews
  drop constraint if exists activity_image_automated_reviews_reviewed_candidate_index_check;

alter table public.activity_image_automated_reviews
  add constraint activity_image_automated_reviews_reviewed_candidate_index_check
    check (reviewed_candidate_index is null or reviewed_candidate_index >= 0);
