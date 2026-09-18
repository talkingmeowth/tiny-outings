-- The museum itself confirms it is no longer at Scala Street. Keep the old
-- record for audit, but never send families to the closed venue.
update public.activities
set archive_previous_listing_status = case
      when public_listing_status in ('draft', 'published') then public_listing_status
      else archive_previous_listing_status end,
    archive = true,
    public_listing_status = 'archived',
    archive_reason = 'Stale venue: Pollock''s Toy Museum left Scala Street (confirmed by the museum)',
    archived_at = coalesce(archived_at, now()),
    updated_at = now()
where activity_id = 'fd1212f3-b8ac-45a9-bcf1-74ce92f28eee'
  and archive = false
  and address ilike '%Scala St%';
