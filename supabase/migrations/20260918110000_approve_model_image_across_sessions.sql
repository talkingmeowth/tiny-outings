-- One manual approval covers every pending time slot for the same programme
-- at the same venue. It changes review proposals only, never live card images.
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
        else p_chosen_image || jsonb_build_object('propagated_from_activity_id', p_activity_id)
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
      lower(regexp_replace(coalesce(sibling.activity_name, ''), '[^[:alnum:]]', '', 'g'))
          = lower(regexp_replace(source_activity.activity_name, '[^[:alnum:]]', '', 'g'))
      and length(regexp_replace(coalesce(sibling.activity_name, ''), '[^[:alnum:]]', '', 'g')) >= 5
      and lower(regexp_replace(coalesce(sibling.address, ''), '[^[:alnum:]]', '', 'g'))
          = lower(regexp_replace(coalesce(source_activity.address, ''), '[^[:alnum:]]', '', 'g'))
      and length(regexp_replace(coalesce(sibling.address, ''), '[^[:alnum:]]', '', 'g')) >= 8
      and coalesce(sibling.category, '') = coalesce(source_activity.category, '')
      and coalesce(sibling.google_place_id, '') = coalesce(source_activity.google_place_id, '')
      and coalesce(sibling.data_source, '') = coalesce(source_activity.data_source, '')
      and coalesce(sibling.source_name, '') = coalesce(source_activity.source_name, '')
    ))
  returning proposal.activity_id, proposal.chosen_image;
end;
$$;

revoke all on function public.approve_model_image_across_sessions(text, uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.approve_model_image_across_sessions(text, uuid, text, jsonb, uuid) to service_role;

-- Apply existing human approvals to still-pending time slots only when every
-- approved slot in that group chose the same URL. Conflicts stay in review.
do $$
declare
  source record;
begin
  for source in
    with active as (
      select proposal.batch_id, proposal.activity_id, proposal.proposal_hash,
        proposal.decision, proposal.chosen_image, proposal.reviewed_by, proposal.reviewed_at,
        lower(regexp_replace(coalesce(activity.activity_name, ''), '[^[:alnum:]]', '', 'g')) as name_key,
        lower(regexp_replace(coalesce(activity.address, ''), '[^[:alnum:]]', '', 'g')) as address_key,
        coalesce(activity.category, '') as category_key,
        coalesce(activity.google_place_id, '') as place_key,
        coalesce(activity.data_source, '') as data_source_key,
        coalesce(activity.source_name, '') as source_name_key
      from public.activity_image_model_proposals proposal
      join public.activities activity on activity.activity_id = proposal.activity_id
      where activity.archive = false
        and activity.public_listing_status in ('draft', 'published')
    ), eligible as (
      select batch_id, name_key, address_key, category_key, place_key,
        data_source_key, source_name_key
      from active
      where length(name_key) >= 5 and length(address_key) >= 8
      group by 1, 2, 3, 4, 5, 6, 7
      having count(*) filter (where decision = 'pending') > 0
        and count(distinct chosen_image->>'image_url') filter (where decision = 'approved') = 1
    )
    select distinct on (active.batch_id, active.name_key, active.address_key,
      active.category_key, active.place_key, active.data_source_key, active.source_name_key)
      active.batch_id, active.activity_id, active.proposal_hash,
      active.chosen_image, active.reviewed_by
    from active
    join eligible using (batch_id, name_key, address_key, category_key, place_key,
      data_source_key, source_name_key)
    where active.decision = 'approved' and active.chosen_image->>'image_url' is not null
    order by active.batch_id, active.name_key, active.address_key,
      active.category_key, active.place_key, active.data_source_key, active.source_name_key,
      active.reviewed_at desc nulls last, active.activity_id
  loop
    perform public.approve_model_image_across_sessions(
      source.batch_id, source.activity_id, source.proposal_hash,
      source.chosen_image, source.reviewed_by
    );
  end loop;
end;
$$;
