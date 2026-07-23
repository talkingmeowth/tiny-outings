-- Editorially removed: not suitable for the family cafe directory.
update public.activities
set public_listing_status = 'archived', updated_at = now()
where activity_id = 'ab25cbcd-eeb3-4835-9fd1-47be530f275c'
  and public_listing_status = 'published';
