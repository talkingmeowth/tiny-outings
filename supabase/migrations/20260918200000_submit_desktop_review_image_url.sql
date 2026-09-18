begin;

-- Append a verified, downloaded administrator URL to the existing proposal.
-- It remains non-live until the reviewer explicitly presses Approve.
create or replace function public.append_model_review_url_candidate(
  p_batch_id text,
  p_activity_id uuid,
  p_proposal_hash text,
  p_candidate jsonb
)
returns public.activity_image_model_proposals
language plpgsql security definer set search_path = public as $$
declare
  updated public.activity_image_model_proposals;
begin
  if p_candidate is null
    or nullif(p_candidate->>'image_url', '') is null
    or nullif(p_candidate->>'submitted_original_url', '') is null
    or p_candidate->>'source_field' is distinct from 'admin_submitted_url'
    or p_candidate->>'model_assessed' is distinct from 'false'
    or p_candidate->>'image_url' !~ '^https://[^/]+[.]supabase[.]co/storage/v1/object/public/activity-images/reviewed/submitted/' then
    raise exception 'Invalid submitted image candidate.';
  end if;

  update public.activity_image_model_proposals proposal
  set alternatives = case
    when proposal.selected_image->>'submitted_original_url' = p_candidate->>'submitted_original_url'
      or exists (
        select 1 from jsonb_array_elements(proposal.alternatives) prior
        where prior->>'submitted_original_url' = p_candidate->>'submitted_original_url'
      ) then proposal.alternatives
    else proposal.alternatives || jsonb_build_array(p_candidate)
    end
  where proposal.batch_id = p_batch_id
    and proposal.activity_id = p_activity_id
    and proposal.proposal_hash = p_proposal_hash
    and exists (
      select 1 from public.activities activity
      where activity.activity_id = p_activity_id
        and activity.archive = false
        and activity.public_listing_status in ('draft', 'published')
    )
  returning proposal.* into updated;

  if updated.activity_id is null then
    raise exception 'The proposal or listing changed. Refresh it first.';
  end if;
  return updated;
end;
$$;

revoke all on function public.append_model_review_url_candidate(text, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.append_model_review_url_candidate(text, uuid, text, jsonb)
  to service_role;

commit;
