-- Share human-approved programme photos for four verified provider families.
-- Distinct age stages, parties and venue-specific banners remain separate.
create or replace function public.image_review_approved_programme_family(a public.activities)
returns text
language sql immutable
as $$
  select case
    when public.image_review_class_provider_host(a) = 'toddlersense.com'
      and coalesce(a.activity_name, '') ~* '^toddler[[:space:]]+sense([[:space:]]|$)'
      then 'toddler_sense'
    when public.image_review_class_provider_host(a) = 'soccerdays.co.uk'
      and coalesce(a.activity_name, '') ~* '^soccerdays[[:space:]]+(orange|red|yellow|purple)[[:space:]]+class$'
      then 'soccerdays_coloured_classes'
    when public.image_review_class_provider_host(a) = 'hartbeeps.com'
      and coalesce(a.activity_name, '') ~* '^hartbeeps[[:space:]]+baby[[:space:]]+beeps([[:space:]]|$)'
      then 'hartbeeps_baby_beeps'
    when public.image_review_class_provider_host(a) = 'miniathletics.com'
      and coalesce(a.activity_name, '') ~* '^mini[[:space:]]+athletics[[:space:]]+didee[[:space:]]+athletes$'
      then 'mini_athletics_didee'
    else null
  end;
$$;

create or replace function public.image_review_approved_programme_photo_transferable(
  a public.activities, p_image jsonb
)
returns boolean
language sql immutable
as $$
  select case public.image_review_approved_programme_family(a)
    when 'toddler_sense' then
      public.image_review_url_host(p_image->>'source_page_url') = 'toddlersense.com'
      and public.image_review_url_host(p_image->>'image_url') = 'toddlersense.com'
    when 'soccerdays_coloured_classes' then
      public.image_review_url_host(p_image->>'source_page_url') = 'soccerdays.co.uk'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 500 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 500 else false end
    when 'hartbeeps_baby_beeps' then
      coalesce(p_image->>'image_url', '') ~* '^https://happity-production[.]s3[.]amazonaws[.]com/uploads/company/banner/16/Hartbeeps_banner[.]jpg'
    when 'mini_athletics_didee' then
      coalesce(p_image->>'image_url', '') ~* '^https://happity-production[.]s3[.]amazonaws[.]com/uploads/company/banner/380/Mini_Athletics_banner[.]jpg'
    else false
  end;
$$;

revoke all on function public.image_review_approved_programme_family(public.activities) from public, anon, authenticated;
revoke all on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) from public, anon, authenticated;
grant execute on function public.image_review_approved_programme_family(public.activities) to service_role;
grant execute on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) to service_role;

-- Preserve the earlier same-venue, same-class and Baby Sensory/Bach to Baby
-- checks inside the renamed base function, including proposal validation.
do $$
begin
  if to_regprocedure('public.approve_model_image_across_sessions_brand_base(text,uuid,text,jsonb,uuid)') is null then
    alter function public.approve_model_image_across_sessions(text, uuid, text, jsonb, uuid)
      rename to approve_model_image_across_sessions_brand_base;
  end if;
end;
$$;

revoke all on function public.approve_model_image_across_sessions_brand_base(text, uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.approve_model_image_across_sessions_brand_base(text, uuid, text, jsonb, uuid) to service_role;

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
  return query select * from public.approve_model_image_across_sessions_brand_base(
    p_batch_id, p_activity_id, p_proposal_hash, p_chosen_image, p_reviewer);

  family := public.image_review_approved_programme_family(source_activity);
  if family is null or not public.image_review_approved_programme_photo_transferable(source_activity, p_chosen_image) then
    return;
  end if;

  -- If prior manual approvals disagree, do not resolve that conflict here.
  if exists (
    select 1
    from public.activity_image_model_proposals other_proposal
    join public.activities other_activity on other_activity.activity_id = other_proposal.activity_id
    where other_proposal.batch_id = p_batch_id
      and other_proposal.decision = 'approved'
      and other_proposal.chosen_image->>'image_url' is distinct from p_chosen_image->>'image_url'
      and other_activity.archive = false
      and other_activity.public_listing_status in ('draft', 'published')
      and public.image_review_approved_programme_family(other_activity) = family
  ) then
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
    and public.image_review_approved_programme_family(sibling) = family
  returning proposal.activity_id, proposal.chosen_image;
end;
$$;

revoke all on function public.approve_model_image_across_sessions(text, uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.approve_model_image_across_sessions(text, uuid, text, jsonb, uuid) to service_role;

-- Backfill only groups with one unambiguous human-approved URL and a
-- transferable donor. Decisions other than pending are never touched.
do $$
declare
  donor record;
begin
  for donor in
    with active as (
      select proposal.batch_id, proposal.activity_id, proposal.proposal_hash,
        proposal.decision, proposal.chosen_image, proposal.reviewed_by, proposal.reviewed_at,
        public.image_review_approved_programme_family(activity) as family,
        public.image_review_approved_programme_photo_transferable(activity, proposal.chosen_image) as can_share
      from public.activity_image_model_proposals proposal
      join public.activities activity on activity.activity_id = proposal.activity_id
      where activity.archive = false
        and activity.public_listing_status in ('draft', 'published')
    ), eligible as (
      select batch_id, family
      from active
      where family is not null
      group by 1, 2
      having count(*) filter (where decision = 'pending') > 0
        and count(distinct chosen_image->>'image_url') filter (where decision = 'approved') = 1
        and count(*) filter (where decision = 'approved' and can_share) > 0
    )
    select distinct on (active.batch_id, active.family)
      active.batch_id, active.activity_id, active.proposal_hash,
      active.chosen_image, active.reviewed_by
    from active join eligible using (batch_id, family)
    where active.decision = 'approved' and active.can_share
    order by active.batch_id, active.family,
      active.reviewed_at desc nulls last, active.activity_id
  loop
    perform public.approve_model_image_across_sessions(
      donor.batch_id, donor.activity_id, donor.proposal_hash,
      donor.chosen_image, donor.reviewed_by);
  end loop;
end;
$$;
