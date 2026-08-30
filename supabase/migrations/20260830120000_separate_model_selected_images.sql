-- Keep automated image choices distinct from images a human administrator has
-- explicitly reviewed. Human review stays higher in the card-image hierarchy.
begin;

alter table public.activities
  add column if not exists model_selected_url text;

comment on column public.activities.model_selected_url is
  'App-owned Storage URL selected and auto-applied by the image review model, pending human confirmation.';

-- Choosing category artwork is an auditable manual decision but deliberately
-- leaves reviewed_image_url empty, so the normal hierarchy can continue.
alter table public.activity_image_manual_reviews
  alter column reviewed_image_url drop not null;

comment on column public.activity_image_manual_reviews.reviewed_image_url is
  'Stored manually selected photo URL, or null when the administrator explicitly chose category artwork/fallback.';

-- Move every still-open model application out of the manual-review field. The
-- conditional clears protect any human choice that may have replaced it.
with latest_auto_applied as (
  select distinct on (activity_id)
    activity_id,
    auto_applied_image_url
  from public.activity_image_automated_reviews
  where status = 'auto_applied'
    and nullif(trim(auto_applied_image_url), '') is not null
  order by activity_id, auto_applied_at desc nulls last, created_at desc
)
update public.activities as activity
set
  model_selected_url = review.auto_applied_image_url,
  reviewed_image_url = case
    when activity.reviewed_image_url = review.auto_applied_image_url then null
    else activity.reviewed_image_url
  end,
  reviewed_image_source_url = case
    when activity.reviewed_image_url = review.auto_applied_image_url then null
    else activity.reviewed_image_source_url
  end,
  reviewed_image_original_url = case
    when activity.reviewed_image_url = review.auto_applied_image_url then null
    else activity.reviewed_image_original_url
  end,
  reviewed_image_selected_at = case
    when activity.reviewed_image_url = review.auto_applied_image_url then null
    else activity.reviewed_image_selected_at
  end,
  reviewed_image_model = case
    when activity.reviewed_image_url = review.auto_applied_image_url then null
    else activity.reviewed_image_model
  end,
  reviewed_image_selected_by_user_id = case
    when activity.reviewed_image_url = review.auto_applied_image_url then null
    else activity.reviewed_image_selected_by_user_id
  end
from latest_auto_applied as review
where review.activity_id = activity.activity_id;

-- Category illustrations are the final UI fallback, not reviewed photos. This
-- also fixes category selections made before this migration was introduced.
update public.activities
set
  reviewed_image_url = null,
  reviewed_image_source_url = null,
  reviewed_image_original_url = null,
  reviewed_image_selected_at = null,
  reviewed_image_model = null,
  reviewed_image_selected_by_user_id = null
where reviewed_image_model = 'Tiny Outings illustrated category image'
   or reviewed_image_original_url ~ '/review/images/(park|bookshop|family-cafe|family-outing)-placeholder\.svg(?:\?.*)?$';

comment on column public.activity_image_automated_reviews.auto_applied_image_url is
  'Storage URL written to activities.model_selected_url when the model choice is auto-applied before human QA.';

commit;
