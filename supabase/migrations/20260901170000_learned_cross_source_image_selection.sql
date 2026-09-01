-- Record why the learned selector chose an image, independently of the raw
-- source fields. Raw SerpAPI and website candidate collections remain intact
-- so a later model can re-rank them without another discovery call.
begin;

alter table public.activities
  add column if not exists model_selected_original_url text,
  add column if not exists model_selected_source_url text,
  add column if not exists model_selected_source_field text,
  add column if not exists model_selected_reason text,
  add column if not exists model_selected_model text,
  add column if not exists model_selected_model_version text;

comment on column public.activities.model_selected_original_url is
  'Remote or stored source image URL selected before the model copy was written to activity-images Storage.';
comment on column public.activities.model_selected_source_url is
  'Source page used to verify the model-selected image identity and provenance.';
comment on column public.activities.model_selected_source_field is
  'Winning source kind or activity field selected by the learned cross-source model.';
comment on column public.activities.model_selected_reason is
  'Auditable explanation combining manual-choice learning, provenance, quality and visual assessment.';
comment on column public.activities.model_selected_model_version is
  'Training-data fingerprint. An unchanged version makes repeated selection idempotent.';

alter table public.activity_image_automated_reviews
  drop constraint if exists activity_image_automated_reviews_candidate_index_check;

alter table public.activity_image_automated_reviews
  add constraint activity_image_automated_reviews_candidate_index_check
    check (candidate_index is null or candidate_index between 0 and 99);

with latest_model_review as (
  select distinct on (activity_id)
    activity_id,
    candidate,
    reason,
    model_name,
    model_version
  from public.activity_image_automated_reviews
  where nullif(trim(auto_applied_image_url), '') is not null
  order by activity_id, auto_applied_at desc nulls last, created_at desc
)
update public.activities as activity
set
  model_selected_original_url = coalesce(activity.model_selected_original_url, nullif(trim(review.candidate ->> 'image_url'), '')),
  model_selected_source_url = coalesce(
    activity.model_selected_source_url,
    nullif(trim(review.candidate ->> 'source_page_url'), ''),
    nullif(trim(review.candidate ->> 'image_url'), '')
  ),
  model_selected_source_field = coalesce(
    activity.model_selected_source_field,
    nullif(trim(review.candidate ->> 'source_field'), ''),
    nullif(trim(review.candidate ->> 'candidate_source'), ''),
    'google_images'
  ),
  model_selected_reason = coalesce(activity.model_selected_reason, review.reason),
  model_selected_model = coalesce(activity.model_selected_model, review.model_name),
  model_selected_model_version = coalesce(activity.model_selected_model_version, review.model_version)
from latest_model_review as review
where review.activity_id = activity.activity_id
  and nullif(trim(activity.model_selected_url), '') is not null;

commit;
