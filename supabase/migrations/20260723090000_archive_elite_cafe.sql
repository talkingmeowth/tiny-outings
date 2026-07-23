-- Remove this venue from the public activity feed while retaining its import
-- history for auditing and to avoid reintroducing it unintentionally.
update public.activities
set public_listing_status = 'archived', updated_at = now()
where activity_id = 'dce2b982-d39d-4b85-bf78-ec6fa1361e75'
  and public_listing_status = 'published';
