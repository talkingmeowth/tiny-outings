-- Brand-level review families: venue and age-band wording does not change the
-- identity of Baby Sensory or Bach to Baby. Keep unrelated sensory classes out.
create or replace function public.image_review_brand_family(a public.activities)
returns text
language sql immutable
as $$
  select case
    when a.category = 'Classes & clubs'
      and coalesce(a.activity_name, '') ~* 'baby[[:space:]]+sensory'
      and (public.image_review_class_provider_host(a) = 'babysensory.com'
        or (a.data_source = 'Google Places'
          and a.source_name = 'Google Places baby sensory activities importer'))
      then 'baby_sensory'
    when coalesce(a.activity_name, '') ~* 'bach[[:space:]]+to[[:space:]]+baby'
      and (public.image_review_url_host(a.organiser_website) = 'bachtobaby.com'
        or (a.data_source = 'Eventbrite'
          and coalesce(a.source_url, '') ilike '%bach-to-baby%'))
      then 'bach_to_baby'
    else null
  end;
$$;

create or replace function public.image_review_brand_photo_transferable(a public.activities, p_image jsonb)
returns boolean
language sql immutable
as $$
  select case public.image_review_brand_family(a)
    when 'baby_sensory' then
      public.image_review_url_host(p_image->>'image_url') = 'babysensory.com'
      or public.image_review_url_host(p_image->>'image_url') like '%.babysensory.com'
      or public.image_review_url_host(p_image->>'source_page_url') = 'babysensory.com'
      or public.image_review_url_host(p_image->>'source_page_url') like '%.babysensory.com'
    when 'bach_to_baby' then
      coalesce(p_image->>'image_url', '') ~* 'bach[+% _-]*to[+% _-]*baby'
      or public.image_review_url_host(p_image->>'source_page_url') = 'bachtobaby.com'
      or public.image_review_url_host(p_image->>'image_url') = 'bachtobaby.com'
      or (coalesce(p_image->>'title', '') ~* 'bach[[:space:]]+to[[:space:]]+baby'
        and public.image_review_url_host(p_image->>'source_page_url') in
          ('eventbrite.co.uk', 'happity.co.uk', 'loopla.com'))
    else false
  end;
$$;

revoke all on function public.image_review_brand_family(public.activities) from public, anon, authenticated;
revoke all on function public.image_review_brand_photo_transferable(public.activities, jsonb) from public, anon, authenticated;
grant execute on function public.image_review_brand_family(public.activities) to service_role;
grant execute on function public.image_review_brand_photo_transferable(public.activities, jsonb) to service_role;

-- Retain the thoroughly checked same-time/same-class rules as the base RPC.
-- The wrapper first validates the original proposal, then extends an approval
-- to still-pending members of either verified brand family in this batch.
do $$
begin
  if to_regprocedure('public.approve_model_image_across_sessions_base(text,uuid,text,jsonb,uuid)') is null then
    alter function public.approve_model_image_across_sessions(text, uuid, text, jsonb, uuid)
      rename to approve_model_image_across_sessions_base;
  end if;
end;
$$;

revoke all on function public.approve_model_image_across_sessions_base(text, uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.approve_model_image_across_sessions_base(text, uuid, text, jsonb, uuid) to service_role;

create or replace function public.approve_model_image_across_sessions(
  p_batch_id text,
  p_activity_id uuid,
  p_proposal_hash text,
  p_chosen_image jsonb,
  p_reviewer uuid
)
returns table(updated_activity_id uuid, approved_image jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  source_activity public.activities;
  family text;
begin
  select * into source_activity from public.activities where activity_id = p_activity_id;

  -- The base RPC performs the source-image, proposal-hash and active-listing
  -- checks, and never alters a sibling with an existing decision.
  return query select * from public.approve_model_image_across_sessions_base(
    p_batch_id, p_activity_id, p_proposal_hash, p_chosen_image, p_reviewer);

  family := public.image_review_brand_family(source_activity);
  if family is null or not public.image_review_brand_photo_transferable(source_activity, p_chosen_image) then
    return;
  end if;

  return query
  update public.activity_image_model_proposals proposal
  set decision = 'approved',
      chosen_image = p_chosen_image || jsonb_build_object(
        'propagated_from_activity_id', p_activity_id,
        'propagated_brand_family', family),
      reviewed_by = p_reviewer,
      reviewed_at = now()
  from public.activities sibling
  where proposal.batch_id = p_batch_id
    and proposal.activity_id = sibling.activity_id
    and proposal.decision = 'pending'
    and sibling.archive = false
    and sibling.public_listing_status in ('draft', 'published')
    and public.image_review_brand_family(sibling) = family
  returning proposal.activity_id, proposal.chosen_image;
end;
$$;

revoke all on function public.approve_model_image_across_sessions(text, uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.approve_model_image_across_sessions(text, uuid, text, jsonb, uuid) to service_role;

-- Existing human-approved, provider-appropriate photos are the donors. These
-- exact choices were checked for the current batch. Prior distinct approvals,
-- rejections and unsure decisions are never replaced.
do $$
declare
  donor record;
begin
  for donor in
    select distinct on (public.image_review_brand_family(activity))
      proposal.batch_id, proposal.activity_id, proposal.proposal_hash,
      proposal.chosen_image, proposal.reviewed_by
    from public.activity_image_model_proposals proposal
    join public.activities activity on activity.activity_id = proposal.activity_id
    where activity.archive = false
      and activity.public_listing_status in ('draft', 'published')
      and proposal.decision = 'approved'
      and (
        (public.image_review_brand_family(activity) = 'baby_sensory'
          and proposal.chosen_image->>'image_url' =
            'https://www.babysensory.com/content/S638961219831874964/638979358315249588_website-banner-size-6.png')
        or (public.image_review_brand_family(activity) = 'bach_to_baby'
          and proposal.chosen_image->>'image_url' like '%Bach+to+Baby+2016%')
      )
    order by public.image_review_brand_family(activity),
      proposal.reviewed_at desc nulls last, proposal.activity_id
  loop
    perform public.approve_model_image_across_sessions(
      donor.batch_id, donor.activity_id, donor.proposal_hash,
      donor.chosen_image, donor.reviewed_by);
  end loop;
end;
$$;
