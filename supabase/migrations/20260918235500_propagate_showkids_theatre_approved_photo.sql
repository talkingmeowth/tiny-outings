-- Share the desktop-approved Show Kids Theatre class photo across the same
-- provider's 4-6 year-old performing-arts workshops, independent of venue.
-- Keep explicitly unsure/rejected decisions and archived activities untouched.
do $$
begin
  if to_regprocedure('public.image_review_approved_programme_family_pre_showkids(public.activities)') is null then
    alter function public.image_review_approved_programme_family(public.activities)
      rename to image_review_approved_programme_family_pre_showkids;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_family(a public.activities)
returns text
language sql immutable
as $$
  select case
    when a.data_source = 'Happity'
      and public.image_review_class_provider_host(a) = 'showkids.co.uk'
      and upper(btrim(coalesce(a.activity_name, ''))) ~ '^SHOWKIDS THEATRE SCHOOL SHOWKIDS [A-Z ]+$'
      and a.age_suitability = '4 years - 6 years'
      and coalesce(a.description, '') ~* 'Performing Arts Workshops'
      then 'showkids_theatre_4_to_6'
    else public.image_review_approved_programme_family_pre_showkids(a)
  end;
$$;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_photo_transferable_pre_showkids(public.activities,jsonb)') is null then
    alter function public.image_review_approved_programme_photo_transferable(public.activities, jsonb)
      rename to image_review_approved_programme_photo_transferable_pre_showkids;
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
    when public.image_review_approved_programme_family(a) = 'showkids_theatre_4_to_6' then
      public.image_review_url_host(p_image->>'source_page_url') = 'showkids.co.uk'
      and public.image_review_url_host(p_image->>'image_url') = 'showkids.co.uk'
      and p_image->>'image_url' =
        'https://showkids.co.uk/wp-content/uploads/2020/06/Midikids-image-3w.png'
      and coalesce(p_image->>'image_url', '') !~* '(logo|icon|sprite)'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 700 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 500 else false end
    else public.image_review_approved_programme_photo_transferable_pre_showkids(a, p_image)
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
  where proposal.activity_id = '1e0797be-9905-4bd1-a32f-3ca08ee92379'
    and activity.archive = false
    and activity.public_listing_status in ('draft', 'published')
    and proposal.decision = 'approved'
    and public.image_review_canonical_group(activity) = 'showkids_theatre_4_to_6'
    and public.image_review_canonical_photo_transferable(activity, proposal.chosen_image)
  limit 1;

  if donor.activity_id is not null then
    perform public.approve_model_image_across_sessions(
      donor.batch_id, donor.activity_id, donor.proposal_hash,
      donor.chosen_image, donor.reviewed_by);
  end if;
end;
$$;
