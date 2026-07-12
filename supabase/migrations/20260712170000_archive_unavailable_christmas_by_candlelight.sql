-- Fever confirms this listing has no tickets and only historic Christmas programme details.
UPDATE public.activities
SET public_listing_status = 'archived', updated_at = now()
WHERE activity_id = '66775102-4425-4aab-9ead-bb8500bc8620';
