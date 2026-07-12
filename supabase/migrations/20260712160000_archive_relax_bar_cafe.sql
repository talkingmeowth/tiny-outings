-- Manually reviewed as unsuitable for Tiny Outings' family-friendly directory.
UPDATE public.activities
SET public_listing_status = 'archived', updated_at = now()
WHERE activity_id = '4e083ac1-1b15-4ae5-862e-a972f0c9f80e';
