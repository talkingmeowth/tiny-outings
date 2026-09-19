-- Rollback-only smoke test: a fresh proposal for a matching listing inherits
-- the manually approved provider photo without retaining any test changes.
begin;

update public.activities
set reviewed_image_url = null,
    desktop_approved_image_url = null
where activity_id = '4e62a2ee-c38c-4456-a043-f16a9aa33a5f';

insert into public.activity_image_model_proposals (
  batch_id, activity_id, activity_snapshot, model_version, status,
  selected_image, proposal_hash, decision
)
select 'dolphin-propagation-rollback-test', activity_id, activity_snapshot,
  model_version, status, selected_image, proposal_hash, 'pending'
from public.activity_image_model_proposals
where activity_id = '4e62a2ee-c38c-4456-a043-f16a9aa33a5f'
limit 1;

do $$
begin
  if not exists (
    select 1 from public.activity_image_model_proposals
    where batch_id = 'dolphin-propagation-rollback-test'
      and decision = 'approved'
      and chosen_image->>'propagated_brand_family' = 'dolphin_swim_academy_baby_swim'
  ) then
    raise exception 'Dolphin Swim Academy propagation failed';
  end if;
end;
$$;

rollback;
