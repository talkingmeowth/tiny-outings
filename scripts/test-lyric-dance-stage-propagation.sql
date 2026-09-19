-- Rollback-only smoke test for future batches of two distinct programmes.
begin;

update public.activities
set desktop_approved_image_url = null
where activity_id in (
  'e5fe7dea-d9e8-4d03-b038-81b0ce9db6a3', -- Baby Ballet
  '3491a6bd-fb50-4ae4-a569-ed01e4c845c9'  -- Performing Arts
);

insert into public.activity_image_model_proposals (
  batch_id, activity_id, activity_snapshot, model_version, status,
  selected_image, proposal_hash, decision
)
select 'lyric-stage-propagation-rollback-test', activity_id,
  activity_snapshot, model_version, status, selected_image, proposal_hash, 'pending'
from public.activity_image_model_proposals
where activity_id in (
  'e5fe7dea-d9e8-4d03-b038-81b0ce9db6a3',
  '3491a6bd-fb50-4ae4-a569-ed01e4c845c9'
);

do $$
begin
  if (
    select count(*)
    from public.activity_image_model_proposals
    where batch_id = 'lyric-stage-propagation-rollback-test'
      and decision = 'approved'
      and chosen_image->>'propagated_brand_family' in (
        'lyric_dance_young_ballet',
        'lyric_dance_lyric_dance_and_performing_arts_school_performing_arts_classes'
      )
  ) <> 2 then
    raise exception 'Lyric Dance stage-specific inheritance failed';
  end if;
end;
$$;

rollback;
