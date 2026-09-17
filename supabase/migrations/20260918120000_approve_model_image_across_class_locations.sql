-- A reviewed class photo can cover the same named programme at other venues.
-- The provider identity must be explicit; council/aggregator domains are not
-- enough to establish that two generically named classes are the same one.
create or replace function public.image_review_url_host(p_url text)
returns text
language sql immutable
as $$
  select lower(regexp_replace(split_part(split_part(coalesce(p_url, ''), '://', 2), '/', 1), '^www[.]', ''));
$$;

create or replace function public.image_review_class_provider_host(a public.activities)
returns text
language sql immutable
as $$
  select public.image_review_url_host(
    coalesce(nullif(btrim(a.organiser_website), ''),
      case when a.data_source = 'Google Places' then nullif(btrim(a.website), '') end,
      ''));
$$;

create or replace function public.image_review_same_class(a public.activities, b public.activities)
returns boolean
language sql immutable
as $$
  select a.category = 'Classes & clubs'
    and b.category = a.category
    and lower(regexp_replace(coalesce(a.activity_name, ''), '[^[:alnum:]]', '', 'g'))
        = lower(regexp_replace(coalesce(b.activity_name, ''), '[^[:alnum:]]', '', 'g'))
    and length(regexp_replace(coalesce(a.activity_name, ''), '[^[:alnum:]]', '', 'g')) >= 8
    and coalesce(a.data_source, '') = coalesce(b.data_source, '')
    and coalesce(a.source_name, '') = coalesce(b.source_name, '')
    and public.image_review_class_provider_host(a) <> ''
    and public.image_review_class_provider_host(a) = public.image_review_class_provider_host(b)
    and public.image_review_class_provider_host(a) !~* '(^|[.])(happity[.]co[.]uk|google[.]com|facebook[.]com|instagram[.]com|gov[.]uk)$';
$$;

create or replace function public.image_review_class_photo_transferable(a public.activities, p_image jsonb)
returns boolean
language sql immutable
as $$
  select public.image_review_class_provider_host(a) <> ''
    and (
      -- Provider-owned pages and image hosts can represent the class at any venue.
      public.image_review_url_host(p_image->>'source_page_url') = public.image_review_class_provider_host(a)
      or public.image_review_url_host(p_image->>'source_page_url') like '%.' || public.image_review_class_provider_host(a)
      or public.image_review_url_host(p_image->>'image_url') = public.image_review_class_provider_host(a)
      or public.image_review_url_host(p_image->>'image_url') like '%.' || public.image_review_class_provider_host(a)
      -- Happity company banners are provider-wide, unlike location-specific listings.
      or coalesce(p_image->>'image_url', '') ~* '^https://happity-production[.]s3[.]amazonaws[.]com/uploads/company/banner/'
    );
$$;

revoke all on function public.image_review_url_host(text) from public, anon, authenticated;
revoke all on function public.image_review_class_provider_host(public.activities) from public, anon, authenticated;
revoke all on function public.image_review_same_class(public.activities, public.activities) from public, anon, authenticated;
revoke all on function public.image_review_class_photo_transferable(public.activities, jsonb) from public, anon, authenticated;
grant execute on function public.image_review_url_host(text) to service_role;
grant execute on function public.image_review_class_provider_host(public.activities) to service_role;
grant execute on function public.image_review_same_class(public.activities, public.activities) to service_role;
grant execute on function public.image_review_class_photo_transferable(public.activities, jsonb) to service_role;

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
  source_proposal public.activity_image_model_proposals;
  source_activity public.activities;
begin
  select * into source_proposal
  from public.activity_image_model_proposals
  where batch_id = p_batch_id and activity_id = p_activity_id
  for update;
  if not found or source_proposal.proposal_hash is distinct from p_proposal_hash then
    raise exception 'The proposal changed. Refresh it first.';
  end if;
  if p_chosen_image is null or nullif(p_chosen_image->>'image_url', '') is null
     or not (
       coalesce(source_proposal.selected_image = p_chosen_image, false)
       or coalesce(source_proposal.alternatives @> jsonb_build_array(p_chosen_image), false)
       or coalesce(source_proposal.decision = 'approved' and source_proposal.chosen_image = p_chosen_image, false)
     ) then
    raise exception 'Approve only a saved image from this proposal.';
  end if;

  select * into source_activity
  from public.activities
  where activity_id = p_activity_id
    and archive = false
    and public_listing_status in ('draft', 'published');
  if not found then raise exception 'This activity is no longer active.'; end if;

  return query
  update public.activity_image_model_proposals proposal
  set decision = 'approved',
      chosen_image = case when proposal.activity_id = p_activity_id then p_chosen_image
        else p_chosen_image || jsonb_build_object(
          'propagated_from_activity_id', p_activity_id,
          'propagated_across_locations',
          lower(regexp_replace(coalesce(sibling.address, ''), '[^[:alnum:]]', '', 'g')) <>
          lower(regexp_replace(coalesce(source_activity.address, ''), '[^[:alnum:]]', '', 'g')))
      end,
      reviewed_by = p_reviewer,
      reviewed_at = now()
  from public.activities sibling
  where proposal.batch_id = p_batch_id
    and proposal.activity_id = sibling.activity_id
    and (proposal.activity_id = p_activity_id or proposal.decision = 'pending')
    and sibling.archive = false
    and sibling.public_listing_status in ('draft', 'published')
    and (proposal.activity_id = p_activity_id or (
      -- The original same-venue rule still covers every category.
      (lower(regexp_replace(coalesce(sibling.activity_name, ''), '[^[:alnum:]]', '', 'g'))
          = lower(regexp_replace(source_activity.activity_name, '[^[:alnum:]]', '', 'g'))
       and length(regexp_replace(coalesce(sibling.activity_name, ''), '[^[:alnum:]]', '', 'g')) >= 5
       and lower(regexp_replace(coalesce(sibling.address, ''), '[^[:alnum:]]', '', 'g'))
          = lower(regexp_replace(coalesce(source_activity.address, ''), '[^[:alnum:]]', '', 'g'))
       and length(regexp_replace(coalesce(sibling.address, ''), '[^[:alnum:]]', '', 'g')) >= 8
       and coalesce(sibling.category, '') = coalesce(source_activity.category, '')
       and coalesce(sibling.google_place_id, '') = coalesce(source_activity.google_place_id, '')
       and coalesce(sibling.data_source, '') = coalesce(source_activity.data_source, '')
       and coalesce(sibling.source_name, '') = coalesce(source_activity.source_name, ''))
      or (public.image_review_same_class(source_activity, sibling)
        and public.image_review_class_photo_transferable(source_activity, p_chosen_image)
        -- Conflicting prior human approvals make the cross-venue choice unsafe.
        and not exists (
          select 1
          from public.activity_image_model_proposals other_proposal
          join public.activities other_activity on other_activity.activity_id = other_proposal.activity_id
          where other_proposal.batch_id = p_batch_id
            and other_proposal.decision = 'approved'
            and other_proposal.chosen_image->>'image_url' is distinct from p_chosen_image->>'image_url'
            and other_activity.archive = false
            and other_activity.public_listing_status in ('draft', 'published')
            and public.image_review_same_class(source_activity, other_activity)
        ))
    ))
  returning proposal.activity_id, proposal.chosen_image;
end;
$$;

revoke all on function public.approve_model_image_across_sessions(text, uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.approve_model_image_across_sessions(text, uuid, text, jsonb, uuid) to service_role;

-- Undo only cross-location copies whose image belongs to another venue or to
-- a venue-specific listing. Never undo the original administrator decision.
update public.activity_image_model_proposals proposal
set decision = 'pending', chosen_image = null, reviewed_by = null, reviewed_at = null
from public.activities activity
where proposal.activity_id = activity.activity_id
  and proposal.decision = 'approved'
  and proposal.chosen_image->>'propagated_across_locations' = 'true'
  and not public.image_review_class_photo_transferable(activity, proposal.chosen_image);

-- Apply already-reviewed, unambiguous class choices to still-pending venues.
do $$
declare
  source record;
begin
  for source in
    with active as (
      select proposal.batch_id, proposal.activity_id, proposal.proposal_hash,
        proposal.decision, proposal.chosen_image, proposal.reviewed_by, proposal.reviewed_at,
        lower(regexp_replace(coalesce(activity.activity_name, ''), '[^[:alnum:]]', '', 'g')) as name_key,
        public.image_review_class_provider_host(activity) as provider_host,
        public.image_review_class_photo_transferable(activity, proposal.chosen_image) as can_share,
        coalesce(activity.data_source, '') as data_source_key,
        coalesce(activity.source_name, '') as source_name_key,
        activity.address
      from public.activity_image_model_proposals proposal
      join public.activities activity on activity.activity_id = proposal.activity_id
      where activity.archive = false
        and activity.public_listing_status in ('draft', 'published')
        and activity.category = 'Classes & clubs'
    ), eligible as (
      select batch_id, name_key, provider_host, data_source_key, source_name_key
      from active
      where length(name_key) >= 8
        and provider_host <> ''
        and provider_host !~* '(^|[.])(happity[.]co[.]uk|google[.]com|facebook[.]com|instagram[.]com|gov[.]uk)$'
      group by 1, 2, 3, 4, 5
      having count(*) filter (where decision = 'pending') > 0
        and count(distinct address) > 1
        and count(distinct chosen_image->>'image_url') filter (where decision = 'approved') = 1
        and count(*) filter (where decision = 'approved' and can_share) > 0
    )
    select distinct on (active.batch_id, active.name_key, active.provider_host,
      active.data_source_key, active.source_name_key)
      active.batch_id, active.activity_id, active.proposal_hash,
      active.chosen_image, active.reviewed_by
    from active
    join eligible using (batch_id, name_key, provider_host, data_source_key, source_name_key)
    where active.decision = 'approved' and active.can_share
      and active.chosen_image->>'image_url' is not null
    order by active.batch_id, active.name_key, active.provider_host,
      active.data_source_key, active.source_name_key,
      active.reviewed_at desc nulls last, active.activity_id
  loop
    perform public.approve_model_image_across_sessions(
      source.batch_id, source.activity_id, source.proposal_hash,
      source.chosen_image, source.reviewed_by
    );
  end loop;
end;
$$;
