-- Use the human-approved Water Babies baby-swimming programme image across
-- verified active Water Babies listings. Admin covers retain display priority.
-- Golden Lane's Google Places listing has no website, so identify that one
-- venue by its exact verified place ID rather than matching a loose name.
do $$
begin
  if to_regprocedure('public.image_review_approved_programme_family_pre_water_babies(public.activities)') is null then
    alter function public.image_review_approved_programme_family(public.activities)
      rename to image_review_approved_programme_family_pre_water_babies;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_family(a public.activities)
returns text
language sql immutable
as $$
  select case
    when a.data_source in ('Happity', 'Google Places')
      and a.category = 'Baby swim'
      and btrim(coalesce(a.activity_name, '')) ~* '^water[[:space:]]+babies([[:space:]]|$)'
      and (
        public.image_review_class_provider_host(a) = 'waterbabies.co.uk'
        or (
          a.data_source = 'Google Places'
          and a.activity_name = 'Water Babies at Golden Lane Campus'
          and a.google_place_id = 'ChIJgwNUJ20ddkgRRKg3Jd40qN0'
        )
      )
      then 'water_babies_baby_swim'
    else public.image_review_approved_programme_family_pre_water_babies(a)
  end;
$$;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_photo_transferable_pre_water_babies(public.activities,jsonb)') is null then
    alter function public.image_review_approved_programme_photo_transferable(public.activities, jsonb)
      rename to image_review_approved_programme_photo_transferable_pre_water_babies;
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
    when public.image_review_approved_programme_family(a) = 'water_babies_baby_swim' then
      public.image_review_url_host(p_image->>'source_page_url') = 'waterbabies.co.uk'
      and p_image->>'image_url' =
        'https://www.waterbabies.co.uk/wp-content/uploads/2025/02/Service-Baby-0-1-V01.png'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 900 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 700 else false end
    else public.image_review_approved_programme_photo_transferable_pre_water_babies(a, p_image)
  end;
$$;

revoke all on function public.image_review_approved_programme_family(public.activities) from public, anon, authenticated;
revoke all on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) from public, anon, authenticated;
grant execute on function public.image_review_approved_programme_family(public.activities) to service_role;
grant execute on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) to service_role;

-- Canonical approval retains the earlier conflicting approval in history,
-- approves active pending siblings, and leaves archived listings unchanged.
do $$
declare donor record;
begin
  select proposal.batch_id, proposal.activity_id, proposal.proposal_hash,
    proposal.chosen_image, proposal.reviewed_by
  into donor
  from public.activity_image_model_proposals proposal
  join public.activities activity on activity.activity_id = proposal.activity_id
  where proposal.activity_id = '283496e9-c563-4685-967b-0318f8be5d0c'
    and activity.archive = false
    and activity.public_listing_status in ('draft', 'published')
    and proposal.decision = 'approved'
    and public.image_review_canonical_group(activity) = 'water_babies_baby_swim'
    and public.image_review_canonical_photo_transferable(activity, proposal.chosen_image)
  limit 1;

  if donor.activity_id is not null then
    perform public.approve_model_image_across_sessions(
      donor.batch_id, donor.activity_id, donor.proposal_hash,
      donor.chosen_image, donor.reviewed_by);
  end if;
end;
$$;
