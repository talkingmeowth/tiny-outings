-- Rollback-only test of inheritance by a future importer proposal.
begin;

update public.activities
set desktop_approved_image_url = null
where activity_id = '4f66920b-8be1-4722-bc97-d88f320ec718';

insert into public.activity_image_model_proposals (
  batch_id, activity_id, activity_snapshot, model_version, status,
  selected_image, proposal_hash, decision
)
select 'nightingale-propagation-rollback-test', activity_id,
  activity_snapshot, model_version, status, selected_image, proposal_hash, 'pending'
from public.activity_image_model_proposals
where activity_id = '4f66920b-8be1-4722-bc97-d88f320ec718'
limit 1;

do $$
begin
  if not exists (
    select 1 from public.activity_image_model_proposals
    where batch_id = 'nightingale-propagation-rollback-test'
      and decision = 'approved'
      and chosen_image->>'propagated_brand_family' = 'nightingale_school_of_dance'
  ) then
    raise exception 'Nightingale image inheritance failed';
  end if;
end;
$$;

rollback;
