-- The approved Hartbeeps company banner is transferable across Hartbeeps
-- programmes, including the explicitly co-run Baby Bells session. Do not
-- transfer a programme-specific photo or override manual/admin card images.
do $$
begin
  if to_regprocedure('public.image_review_approved_programme_family_pre_hartbeeps_all(public.activities)') is null then
    alter function public.image_review_approved_programme_family(public.activities)
      rename to image_review_approved_programme_family_pre_hartbeeps_all;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_family(a public.activities)
returns text
language sql immutable
as $$
  select case
    when a.data_source in ('Happity', 'Google Places')
      and btrim(coalesce(a.activity_name, '')) ~* '^hartbeeps([[:space:]]|$)'
      and coalesce(a.activity_name, '') !~* '(birthday|party|holiday)'
      and public.image_review_class_provider_host(a) = 'hartbeeps.com'
      then 'hartbeeps_programmes'
    when a.data_source = 'Happity'
      and a.activity_name =
        'WENTWORTH CHILDREN S CENTRE BABY BELLS WITH HARTBEEPS FOR HACKNEY FAMILIES'
      and coalesce(a.website, '') ~* '^https://www[.]happity[.]co[.]uk/schedules/wentworth-children-s-centre-.*baby-bells-with-hartbeeps-'
      then 'hartbeeps_programmes'
    else public.image_review_approved_programme_family_pre_hartbeeps_all(a)
  end;
$$;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_photo_transferable_pre_hartbeeps_all(public.activities,jsonb)') is null then
    alter function public.image_review_approved_programme_photo_transferable(public.activities, jsonb)
      rename to image_review_approved_programme_photo_transferable_pre_hartbeeps_all;
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
    when public.image_review_approved_programme_family(a) = 'hartbeeps_programmes' then
      public.image_review_url_host(p_image->>'source_page_url') = 'happity.co.uk'
      and p_image->>'image_url' =
        'https://happity-production.s3.amazonaws.com/uploads/company/banner/16/Hartbeeps_banner.jpg?v=1681411925'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 800 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 300 else false end
    else public.image_review_approved_programme_photo_transferable_pre_hartbeeps_all(a, p_image)
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
  where proposal.activity_id = '0f3288c4-4b7c-447a-a81a-6073a8b9fdfc'
    and activity.archive = false
    and activity.public_listing_status in ('draft', 'published')
    and proposal.decision = 'approved'
    and public.image_review_canonical_group(activity) = 'hartbeeps_programmes'
    and public.image_review_canonical_photo_transferable(activity, proposal.chosen_image)
  limit 1;

  if donor.activity_id is not null then
    perform public.approve_model_image_across_sessions(
      donor.batch_id, donor.activity_id, donor.proposal_hash,
      donor.chosen_image, donor.reviewed_by);
  end if;
end;
$$;
