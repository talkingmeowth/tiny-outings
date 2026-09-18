-- Waltham Forest's Exploring Foods sessions use the same approved activity
-- image across venues. Restrict transfer to the council's event listings and
-- the exact high-resolution food image approved for two existing sessions.
do $$
begin
  if to_regprocedure('public.image_review_approved_programme_family_pre_exploring_foods(public.activities)') is null then
    alter function public.image_review_approved_programme_family(public.activities)
      rename to image_review_approved_programme_family_pre_exploring_foods;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_family(a public.activities)
returns text
language sql immutable
as $$
  select case
    when a.data_source = 'better_start_for_life'
      and a.category = 'Classes & clubs'
      and btrim(coalesce(a.activity_name, '')) ~* '^exploring[[:space:]]+foods[[:space:]]+at[[:space:]]+'
      and coalesce(a.website, '') ~* '^https://www[.]walthamforest[.]gov[.]uk/events/exploring-foods-'
      then 'waltham_forest_exploring_foods'
    else public.image_review_approved_programme_family_pre_exploring_foods(a)
  end;
$$;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_photo_transferable_pre_exploring_foods(public.activities,jsonb)') is null then
    alter function public.image_review_approved_programme_photo_transferable(public.activities, jsonb)
      rename to image_review_approved_programme_photo_transferable_pre_exploring_foods;
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
    when public.image_review_approved_programme_family(a) = 'waltham_forest_exploring_foods' then
      public.image_review_url_host(p_image->>'source_page_url') = 'walthamforest.gov.uk'
      and p_image->>'image_url' =
        'https://www.walthamforest.gov.uk/sites/default/files/styles/x_small_3_2_546_x_364_/public/2024-09/Untitled%20design%20%281%29_0.png.webp?h=968c7e23&itok=8opEKrxi'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 800 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 500 else false end
    else public.image_review_approved_programme_photo_transferable_pre_exploring_foods(a, p_image)
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
  where proposal.activity_id = '27233d42-baf6-4065-9011-59e366786e42'
    and activity.archive = false
    and activity.public_listing_status in ('draft', 'published')
    and proposal.decision = 'approved'
    and public.image_review_canonical_group(activity) = 'waltham_forest_exploring_foods'
    and public.image_review_canonical_photo_transferable(activity, proposal.chosen_image)
  limit 1;

  if donor.activity_id is not null then
    perform public.approve_model_image_across_sessions(
      donor.batch_id, donor.activity_id, donor.proposal_hash,
      donor.chosen_image, donor.reviewed_by);
  end if;
end;
$$;
