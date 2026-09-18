-- Cindy's Swim School listings are the same parent-and-baby swimming provider
-- at different pools. Reuse the human-approved lesson photo from its official
-- site, rather than the separate Brixton pool photo, across active venues.
do $$
begin
  if to_regprocedure('public.image_review_approved_programme_family_pre_cindys(public.activities)') is null then
    alter function public.image_review_approved_programme_family(public.activities)
      rename to image_review_approved_programme_family_pre_cindys;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_family(a public.activities)
returns text
language sql immutable
as $$
  select case
    when a.data_source = 'Google Places'
      and a.category = 'Baby swim'
      and public.image_review_class_provider_host(a) = 'cindysswimschool.co.uk'
      and btrim(coalesce(a.activity_name, '')) ~* '^cindy.s[[:space:]]+swim[[:space:]]+school([,[:space:]]|$)'
      then 'cindys_swim_school'
    else public.image_review_approved_programme_family_pre_cindys(a)
  end;
$$;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_photo_transferable_pre_cindys(public.activities,jsonb)') is null then
    alter function public.image_review_approved_programme_photo_transferable(public.activities, jsonb)
      rename to image_review_approved_programme_photo_transferable_pre_cindys;
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
    when public.image_review_approved_programme_family(a) = 'cindys_swim_school' then
      public.image_review_url_host(p_image->>'source_page_url') = 'cindysswimschool.co.uk'
      and p_image->>'image_url' =
        'https://cindysswimschool.co.uk/wp-content/uploads/2025/07/Wandsworth-Baby-Swimming-1-768x432.png'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 700 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 400 else false end
    else public.image_review_approved_programme_photo_transferable_pre_cindys(a, p_image)
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
  where proposal.activity_id = '24aa268e-acf4-4bf3-bf40-1f54a2bdd08e'
    and activity.archive = false
    and activity.public_listing_status in ('draft', 'published')
    and proposal.decision = 'approved'
    and public.image_review_canonical_group(activity) = 'cindys_swim_school'
    and public.image_review_canonical_photo_transferable(activity, proposal.chosen_image)
  limit 1;

  if donor.activity_id is not null then
    perform public.approve_model_image_across_sessions(
      donor.batch_id, donor.activity_id, donor.proposal_hash,
      donor.chosen_image, donor.reviewed_by);
  end if;
end;
$$;
