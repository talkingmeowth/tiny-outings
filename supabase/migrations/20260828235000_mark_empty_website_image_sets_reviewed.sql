-- Empty discovery sets have no candidate that a selector can evaluate. Mark
-- that candidate-set revision terminal so completion reporting is accurate.
update public.activities
set
  website_image_vision_reviewed_at = coalesce(website_image_vision_reviewed_at, website_image_candidates_fetched_at, now()),
  website_image_vision_model = coalesce(website_image_vision_model, 'No-candidate terminal marker'),
  website_image_vision_status = coalesce(website_image_vision_status, 'rejected'),
  website_image_vision_candidate_index = null,
  website_image_vision_reason = coalesce(
    website_image_vision_reason,
    'Official-website discovery completed but returned no eligible image candidates.'
  ),
  website_image_vision_candidates_fetched_at = coalesce(
    website_image_vision_candidates_fetched_at,
    website_image_candidates_fetched_at,
    now()
  )
where website_image_candidates_fetched_at is not null
  and jsonb_array_length(coalesce(website_image_candidates, '[]'::jsonb)) = 0
  and website_image_vision_reviewed_at is null;
