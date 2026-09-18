begin;

do $$
declare
  sample public.activity_image_model_proposals;
  updated public.activity_image_model_proposals;
  submitted text := 'https://test-photo.supabase.co/storage/v1/object/public/activity-images/reviewed/submitted/00000000-0000-0000-0000-000000000000/test.png';
begin
  select proposal.* into sample
  from public.activity_image_model_proposals proposal
  join public.activities activity using (activity_id)
  where activity.archive = false
    and activity.public_listing_status in ('draft', 'published')
  order by proposal.created_at desc
  limit 1;
  if sample.activity_id is null then raise exception 'No active proposal available for the URL submission test.'; end if;

  select * into updated from public.append_model_review_url_candidate(
    sample.batch_id, sample.activity_id, sample.proposal_hash,
    jsonb_build_object(
      'image_url', submitted,
      'submitted_original_url', 'https://photos.example.org/test-photo.png',
      'source_field', 'admin_submitted_url',
      'model_assessed', false
    )
  );
  if jsonb_array_length(updated.alternatives) <> jsonb_array_length(sample.alternatives) + 1 then
    raise exception 'The new photo was not appended.';
  end if;

  select * into updated from public.append_model_review_url_candidate(
    sample.batch_id, sample.activity_id, sample.proposal_hash,
    jsonb_build_object(
      'image_url', submitted,
      'submitted_original_url', 'https://photos.example.org/test-photo.png',
      'source_field', 'admin_submitted_url',
      'model_assessed', false
    )
  );
  if jsonb_array_length(updated.alternatives) <> jsonb_array_length(sample.alternatives) + 1 then
    raise exception 'Submitting the same URL twice created a duplicate.';
  end if;
end;
$$;

rollback;
