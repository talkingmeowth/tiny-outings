-- Record one learned-selector pass for every live or draft listing, while
-- retaining the original priority queue labels for missing/unsuitable cases.
alter table public.activity_image_automated_reviews
  drop constraint if exists activity_image_automated_reviews_source_queue_check;

alter table public.activity_image_automated_reviews
  add constraint activity_image_automated_reviews_source_queue_check
    check (source_queue in (
      'missing_published',
      'unsuitable_audit',
      'both',
      'all_published',
      'all_draft'
    ));
