-- Quick review approval confirms the image currently displayed by the card
-- without changing image selection. The URL/source snapshot makes approval
-- automatically stale when a higher-priority image later replaces it.
begin;

alter table public.activities
  add column if not exists image_review_approved_at timestamptz,
  add column if not exists image_review_approved_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists image_review_approved_url text,
  add column if not exists image_review_approved_original_url text,
  add column if not exists image_review_approved_source_field text,
  add column if not exists image_review_approved_source_url text;

comment on column public.activities.image_review_approved_at is
  'When an administrator approved the currently displayed card image in desktop quick review.';
comment on column public.activities.image_review_approved_url is
  'Displayed card-image URL snapshot. Approval is current only while this URL and source field still match the card.';
comment on column public.activities.image_review_approved_original_url is
  'Original remote or uploaded image URL represented by the approved displayed image.';
comment on column public.activities.image_review_approved_source_field is
  'Image field or category_placeholder that was displayed at approval time.';
comment on column public.activities.image_review_approved_source_url is
  'Source page or original URL associated with the approved card image.';

create index if not exists activities_current_image_approval_idx
  on public.activities (image_review_approved_at desc)
  where image_review_approved_at is not null;

-- One service-only view exposes every positive human signal in one shape.
-- Quick approvals and full-review choices come from the immutable manual log;
-- current reviewed/admin fields and uploads add ground truth that predates it.
create or replace view public.activity_image_ground_truth
with (security_invoker = true)
as
select
  'manual:' || review.manual_review_id::text as ground_truth_id,
  review.activity_id,
  coalesce(review.reviewed_image_url, review.original_image_url) as image_url,
  review.original_image_url,
  review.source_page_url,
  coalesce(
    nullif(review.candidate ->> 'source_field', ''),
    nullif(review.candidate ->> 'candidate_source', ''),
    case when review.candidate ->> 'selection_kind' = 'category_illustration' then 'category_placeholder' end,
    'manual_review'
  ) as source_field,
  coalesce(nullif(review.candidate ->> 'source_label', ''), review.model) as source_label,
  'approved'::text as ground_truth_label,
  case
    when review.candidate ->> 'selection_kind' = 'current_image_approval' then 'quick_review_approval'
    when review.candidate ->> 'selection_kind' = 'category_illustration' then 'manual_category_choice'
    else 'manual_image_selection'
  end as evidence_type,
  coalesce(review.candidate ->> 'selection_kind', 'manual_selection') <> 'category_illustration'
    and lower(coalesce(review.candidate ->> 'is_category_art', 'false')) <> 'true' as is_photo,
  review.selected_by_user_id,
  review.created_at as evidence_at,
  review.candidate as metadata
from public.activity_image_manual_reviews as review
where nullif(trim(coalesce(review.reviewed_image_url, review.original_image_url)), '') is not null

union all

select
  'current-reviewed:' || activity.activity_id::text,
  activity.activity_id,
  activity.reviewed_image_url,
  coalesce(activity.reviewed_image_original_url, activity.reviewed_image_url),
  coalesce(activity.reviewed_image_source_url, activity.reviewed_image_original_url, activity.reviewed_image_url),
  'reviewed_image_url',
  'Manual desktop review',
  'approved',
  'current_reviewed_image',
  true,
  activity.reviewed_image_selected_by_user_id,
  coalesce(activity.reviewed_image_selected_at, activity.updated_at),
  jsonb_build_object('model', activity.reviewed_image_model)
from public.activities as activity
where nullif(trim(activity.reviewed_image_url), '') is not null

union all

select
  'admin-cover:' || activity.activity_id::text,
  activity.activity_id,
  activity.admin_cover_image_url,
  activity.admin_cover_image_url,
  activity.admin_cover_image_url,
  'admin_cover_image_url',
  'Admin cover',
  'approved',
  'admin_uploaded_cover',
  true,
  null::uuid,
  activity.updated_at,
  '{}'::jsonb
from public.activities as activity
where nullif(trim(activity.admin_cover_image_url), '') is not null

union all

select
  'admin-url:' || activity.activity_id::text,
  activity.activity_id,
  activity.user_image_url,
  activity.user_image_url,
  activity.user_image_url,
  'user_image_url',
  'Admin image URL',
  'approved',
  'admin_provided_url',
  true,
  null::uuid,
  activity.updated_at,
  '{}'::jsonb
from public.activities as activity
where nullif(trim(activity.user_image_url), '') is not null

union all

select
  'upload:' || photo.photo_id::text,
  photo.activity_id,
  photo.photo_url,
  photo.photo_url,
  coalesce(photo.source_url, photo.photo_url),
  'user_uploaded_image_url',
  'Uploaded activity image',
  'approved',
  'uploaded_image',
  true,
  photo.user_id,
  photo.created_at,
  jsonb_build_object('photo_id', photo.photo_id, 'caption', photo.caption, 'source_provider', photo.source_provider)
from public.activity_photos as photo
where photo.source_provider = 'user_upload'
  and nullif(trim(photo.photo_url), '') is not null;

comment on view public.activity_image_ground_truth is
  'Unified positive image ground truth from quick approvals, manual selections, admin cover/URL choices and uploaded images. Category-art rows are retained with is_photo=false.';

revoke all on public.activity_image_ground_truth from public, anon, authenticated;
grant select on public.activity_image_ground_truth to service_role;

commit;
