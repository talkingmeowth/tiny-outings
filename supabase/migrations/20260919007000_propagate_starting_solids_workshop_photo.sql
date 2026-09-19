-- Starting Solids is the same workshop theme across these family-hub venues.
-- Share the already-approved, visually checked food photograph. Keep archived
-- listings and unrelated classes outside this family.
do $$
begin
  if to_regprocedure('public.image_review_approved_programme_family_pre_starting_solids(public.activities)') is null then
    alter function public.image_review_approved_programme_family(public.activities)
      rename to image_review_approved_programme_family_pre_starting_solids;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_family(a public.activities)
returns text
language sql immutable
as $$
  select case
    when a.data_source = 'better_start_for_life'
      and lower(coalesce(a.activity_name, '')) ~ '^starting solids( foods)? workshop([[:space:]]|$)'
      then 'starting_solids_workshop'
    else public.image_review_approved_programme_family_pre_starting_solids(a)
  end;
$$;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_photo_transferable_pre_starting_solids(public.activities,jsonb)') is null then
    alter function public.image_review_approved_programme_photo_transferable(public.activities, jsonb)
      rename to image_review_approved_programme_photo_transferable_pre_starting_solids;
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
    when 'starting_solids_workshop' then
      p_image->>'image_url' =
        'https://www.walthamforest.gov.uk/sites/default/files/styles/x_small_3_2_546_x_364_/public/2024-09/Untitled%20design%20%281%29_0.png.webp?h=968c7e23&itok=8opEKrxi'
      and public.image_review_url_host(p_image->>'source_page_url') = 'walthamforest.gov.uk'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 800 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 500 else false end
    else public.image_review_approved_programme_photo_transferable_pre_starting_solids(a, p_image)
  end;
$$;

revoke all on function public.image_review_approved_programme_family(public.activities) from public, anon, authenticated;
revoke all on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) from public, anon, authenticated;
grant execute on function public.image_review_approved_programme_family(public.activities) to service_role;
grant execute on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) to service_role;

-- Two Lambeth proposals were rejected because their old selections were not
-- suitable. The Waltham Forest workshop photo is a generic food scene, so
-- explicitly approve it for these two cases without restoring rejected photos.
do $$
declare
  donor public.activity_image_model_proposals;
  item record;
  proposal public.activity_image_model_proposals;
  candidate jsonb;
begin
  select * into donor
  from public.activity_image_model_proposals
  where activity_id = '1238d003-35b5-4daf-9359-3c2f4c5d73ae'
    and decision = 'approved';
  if not found or donor.chosen_image is null then
    raise exception 'Starting Solids approved donor is missing';
  end if;

  for item in
    select activity_id, activity_name
    from public.activities
    where activity_id in (
      '19d9fddc-e21a-4928-8782-87848a1929f5',
      '3cf50fa0-11f3-4feb-b1c7-e88952b47fe3'
    )
      and archive = false
      and public_listing_status in ('draft', 'published')
      and data_source = 'better_start_for_life'
      and lower(activity_name) ~ '^starting solids( foods)? workshop([[:space:]]|$)'
  loop
    select * into proposal
    from public.activity_image_model_proposals
    where activity_id = item.activity_id
    for update;
    if not found or proposal.decision not in ('pending', 'rejected', 'approved') then
      continue;
    end if;
    if proposal.decision = 'approved'
      and proposal.chosen_image->>'image_url' = donor.chosen_image->>'image_url' then
      continue;
    end if;
    candidate := donor.chosen_image || jsonb_build_object(
      'propagated_from_activity_id', donor.activity_id,
      'propagated_brand_family', 'starting_solids_workshop',
      'auto_approval_method', 'visually_checked_same_workshop_photo'
    );
    update public.activity_image_model_proposals
    set alternatives = coalesce(alternatives, '[]'::jsonb) || jsonb_build_array(candidate)
    where batch_id = proposal.batch_id and activity_id = proposal.activity_id;
    perform public.approve_model_image_across_sessions(
      proposal.batch_id, proposal.activity_id, proposal.proposal_hash,
      candidate, null
    );
  end loop;
end;
$$;
