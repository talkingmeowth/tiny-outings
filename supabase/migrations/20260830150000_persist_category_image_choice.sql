-- Keep an administrator's category-illustration choice separate from a
-- manually reviewed photo URL. The image resolver treats this as the manual
-- review position in the hierarchy, immediately below an admin cover image.
alter table public.activities
  add column if not exists use_category_image boolean not null default false;

comment on column public.activities.use_category_image is
  'When true, the activity card uses its illustrated category image at the reviewed-image priority instead of reviewed_image_url.';

-- Restore category choices already recorded by the desktop reviewer before
-- the explicit flag existed. Only the most recent manual image decision wins.
with latest_manual_decision as (
  select distinct on (activity_id)
    activity_id,
    candidate
  from public.activity_image_manual_reviews
  order by activity_id, created_at desc, manual_review_id desc
)
update public.activities as activity
set use_category_image = true
from latest_manual_decision as decision
where decision.activity_id = activity.activity_id
  and decision.candidate ->> 'selection_kind' = 'category_illustration'
  and activity.reviewed_image_url is null;
