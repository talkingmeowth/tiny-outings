-- Keep large proposal alternatives inside Postgres during approval. The review
-- Edge Function can now submit only the selected URL instead of downloading
-- and re-uploading the whole alternatives array for every decision.
create or replace function public.approve_model_image_url_across_sessions(
  p_batch_id text,
  p_activity_id uuid,
  p_proposal_hash text,
  p_image_url text,
  p_reviewer uuid
)
returns table(updated_activity_id uuid, approved_image jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chosen_image jsonb;
begin
  if p_image_url is null or p_image_url !~* '^https?://[^[:space:]]+$' then
    raise exception 'Approve only an image from this proposal.';
  end if;

  select candidate.image
  into v_chosen_image
  from public.activity_image_model_proposals proposal
  cross join lateral (
    select proposal.selected_image as image, 0 as priority
    where proposal.selected_image->>'image_url' = p_image_url
    union all
    select alternative.value as image, 1 as priority
    from jsonb_array_elements(proposal.alternatives) alternative(value)
    where alternative.value->>'image_url' = p_image_url
    union all
    select proposal.chosen_image as image, 2 as priority
    where proposal.decision = 'approved'
      and proposal.chosen_image->>'image_url' = p_image_url
  ) candidate
  where proposal.batch_id = p_batch_id
    and proposal.activity_id = p_activity_id
    and proposal.proposal_hash = p_proposal_hash
  order by candidate.priority
  limit 1;

  if v_chosen_image is null then
    raise exception 'Approve only an image from this proposal.';
  end if;

  return query
  select * from public.approve_model_image_across_sessions(
    p_batch_id, p_activity_id, p_proposal_hash, v_chosen_image, p_reviewer
  );
end;
$$;

revoke all on function public.approve_model_image_url_across_sessions(text, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.approve_model_image_url_across_sessions(text, uuid, text, text, uuid)
  to service_role;

-- The live-image sync trigger looks up the newest human decision for each
-- affected activity. This avoids scanning every proposal once per propagated
-- sibling during an approval.
create index if not exists activity_image_model_proposals_live_review_idx
  on public.activity_image_model_proposals
    (activity_id, reviewed_at desc, created_at desc, batch_id desc)
  where decision in ('approved', 'rejected', 'unsure');
