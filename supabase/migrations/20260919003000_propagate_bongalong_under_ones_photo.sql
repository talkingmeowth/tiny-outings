-- Bongalong's approved, high-resolution baby-with-xylophone photo represents
-- its Under Ones music sessions across venues and seasonal/trial variants.
-- Keep the separately approved Under Fives class photo and archived rows.
do $$
begin
  if to_regprocedure('public.image_review_approved_programme_family_pre_bongalong_under_ones(public.activities)') is null then
    alter function public.image_review_approved_programme_family(public.activities)
      rename to image_review_approved_programme_family_pre_bongalong_under_ones;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_family(a public.activities)
returns text
language sql immutable
as $$
  select case
    when a.data_source = 'Happity'
      and public.image_review_class_provider_host(a) = 'bongalong.co.uk'
      and upper(btrim(coalesce(a.activity_name, ''))) in (
        'BONGALONG BABY SUMMER FUN UNDER ONES',
        'BONGALONG PAYG UNDER ONES',
        'BONGALONG UNDER ONES TRIAL SESSION'
      )
      and a.age_suitability = '0 months - 12 months'
      then 'bongalong_under_ones'
    else public.image_review_approved_programme_family_pre_bongalong_under_ones(a)
  end;
$$;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_photo_transferable_pre_bongalong_under_ones(public.activities,jsonb)') is null then
    alter function public.image_review_approved_programme_photo_transferable(public.activities, jsonb)
      rename to image_review_approved_programme_photo_transferable_pre_bongalong_under_ones;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_photo_transferable(
  a public.activities, p_image jsonb
)
returns boolean
language sql immutable
as $$
  select case
    when public.image_review_approved_programme_family(a) = 'bongalong_under_ones' then
      public.image_review_url_host(p_image->>'source_page_url') = 'bongalong.co.uk'
      and public.image_review_url_host(p_image->>'image_url') = 'bongalong.co.uk'
      and p_image->>'image_url' =
        'http://bongalong.co.uk/wp-content/uploads/2015/02/Evie-xylophone.jpg'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 2000 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 2000 else false end
    else public.image_review_approved_programme_photo_transferable_pre_bongalong_under_ones(a, p_image)
  end;
$$;

revoke all on function public.image_review_approved_programme_family(public.activities) from public, anon, authenticated;
revoke all on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) from public, anon, authenticated;
grant execute on function public.image_review_approved_programme_family(public.activities) to service_role;
grant execute on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) to service_role;

do $$
declare donor record;
begin
  select proposal.batch_id, proposal.activity_id, proposal.proposal_hash,
    proposal.chosen_image, proposal.reviewed_by
  into donor
  from public.activity_image_model_proposals proposal
  join public.activities activity on activity.activity_id = proposal.activity_id
  where proposal.activity_id = '16bed9b7-1707-4324-a477-4c4ec8d2749e'
    and activity.archive = false
    and activity.public_listing_status in ('draft', 'published')
    and proposal.decision = 'approved'
    and public.image_review_canonical_group(activity) = 'bongalong_under_ones'
    and public.image_review_canonical_photo_transferable(activity, proposal.chosen_image)
  limit 1;

  if donor.activity_id is not null then
    perform public.approve_model_image_across_sessions(
      donor.batch_id, donor.activity_id, donor.proposal_hash,
      donor.chosen_image, donor.reviewed_by);
  end if;
end;
$$;
