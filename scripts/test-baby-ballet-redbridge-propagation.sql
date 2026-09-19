-- Rollback-only smoke test for future Baby Ballet Redbridge proposals.
begin;

update public.activities
set desktop_approved_image_url = null
where activity_id = '5a25418a-5931-4497-b85b-0795f65efbb9';

insert into public.activity_image_model_proposals (
  batch_id, activity_id, activity_snapshot, model_version, status,
  selected_image, proposal_hash, decision
)
select 'baby-ballet-redbridge-rollback-test', activity_id,
  activity_snapshot, model_version, status, selected_image, proposal_hash, 'pending'
from public.activity_image_model_proposals
where activity_id = '5a25418a-5931-4497-b85b-0795f65efbb9'
limit 1;

do $$
begin
  if not exists (
    select 1 from public.activity_image_model_proposals
    where batch_id = 'baby-ballet-redbridge-rollback-test'
      and decision = 'approved'
      and chosen_image->>'propagated_brand_family' = 'baby_ballet_redbridge_ballet_school'
      and chosen_image->>'image_url' =
        'https://redbridgeballetschool.co.uk/storage/classes/01KM0H7RPW2K530P33HMZW1W1J.jpg'
  ) then
    raise exception 'Baby Ballet Redbridge image inheritance failed';
  end if;
end;
$$;

rollback;
