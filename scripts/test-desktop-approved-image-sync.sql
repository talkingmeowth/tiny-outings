-- Transactional integration check: no review decision persists from this test.
begin;
do $$
declare
  sample record;
  mirrored text;
begin
  select p.batch_id, p.activity_id, p.chosen_image
  into sample
  from public.activity_image_model_proposals p
  join public.activities a using (activity_id)
  where p.decision = 'approved' and a.archive = false
    and a.public_listing_status = 'draft'
    and a.desktop_approved_image_url = p.chosen_image->>'image_url'
  order by p.reviewed_at desc
  limit 1
  for update of p;

  if sample.activity_id is null then
    raise exception 'No approved draft to test desktop image sync.';
  end if;

  update public.activity_image_model_proposals
  set decision = 'rejected', chosen_image = null, reviewed_at = now()
  where batch_id = sample.batch_id and activity_id = sample.activity_id;
  select desktop_approved_image_url into mirrored
  from public.activities where activity_id = sample.activity_id;
  if mirrored is not null then
    raise exception 'Reject did not remove the live desktop approval.';
  end if;

  update public.activity_image_model_proposals
  set decision = 'approved', chosen_image = sample.chosen_image, reviewed_at = now()
  where batch_id = sample.batch_id and activity_id = sample.activity_id;
  select desktop_approved_image_url into mirrored
  from public.activities where activity_id = sample.activity_id;
  if mirrored is distinct from sample.chosen_image->>'image_url' then
    raise exception 'Approval did not restore the live desktop image.';
  end if;
end;
$$;
rollback;
