-- Zip Zap Babies and Zip Zap Toddlers are separate programmes. Transfer a
-- human-approved high-resolution photo only within its matching class.
do $$
begin
  if to_regprocedure('public.image_review_approved_programme_family_pre_zip_zap(public.activities)') is null then
    alter function public.image_review_approved_programme_family(public.activities)
      rename to image_review_approved_programme_family_pre_zip_zap;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_family(a public.activities)
returns text
language sql immutable
as $$
  select case
    when a.data_source = 'Happity'
      and a.category = 'Classes & clubs'
      and public.image_review_class_provider_host(a) = 'zipzapkids.com'
      and upper(btrim(coalesce(a.activity_name, ''))) = 'ZIP ZAP BABIES'
      then 'zip_zap_babies'
    when a.data_source = 'Happity'
      and a.category = 'Classes & clubs'
      and public.image_review_class_provider_host(a) = 'zipzapkids.com'
      and upper(btrim(coalesce(a.activity_name, ''))) = 'ZIP ZAP TODDLERS'
      then 'zip_zap_toddlers'
    else public.image_review_approved_programme_family_pre_zip_zap(a)
  end;
$$;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_photo_transferable_pre_zip_zap(public.activities,jsonb)') is null then
    alter function public.image_review_approved_programme_photo_transferable(public.activities, jsonb)
      rename to image_review_approved_programme_photo_transferable_pre_zip_zap;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_photo_transferable(
  a public.activities, p_image jsonb
)
returns boolean
language sql immutable
as $$
  select case public.image_review_approved_programme_family(a)
    when 'zip_zap_babies' then
      public.image_review_url_host(p_image->>'source_page_url') = 'happity.co.uk'
      and p_image->>'image_url' =
        'https://happity-production.s3.amazonaws.com/uploads/provider/banner/6763/Zip_Zap_Zip_Zap_Waltham_Forest_and_East_Village_banner.jpg?v=1681413597'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 1500 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 1000 else false end
    when 'zip_zap_toddlers' then
      public.image_review_url_host(p_image->>'source_page_url') = 'happity.co.uk'
      and p_image->>'image_url' =
        'https://happity-production.s3.amazonaws.com/uploads/company/banner/1196/Zip_Zap_banner.png?v=1681410810'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 1500 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 1000 else false end
    else public.image_review_approved_programme_photo_transferable_pre_zip_zap(a, p_image)
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
  where proposal.activity_id = '294e05f8-9351-4283-b11e-09ad6e736849'
    and activity.archive = false
    and activity.public_listing_status in ('draft', 'published')
    and proposal.decision = 'approved'
    and public.image_review_canonical_group(activity) = 'zip_zap_babies'
    and public.image_review_canonical_photo_transferable(activity, proposal.chosen_image)
  limit 1;

  if donor.activity_id is not null then
    perform public.approve_model_image_across_sessions(
      donor.batch_id, donor.activity_id, donor.proposal_hash,
      donor.chosen_image, donor.reviewed_by);
  end if;
end;
$$;
