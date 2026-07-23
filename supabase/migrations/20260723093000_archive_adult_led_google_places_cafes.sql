-- Keep the family cafe feed free of venues Google classifies as bars or pubs.
-- Other cafe and restaurant subtypes are retained unless separately reviewed.
update public.activities
set public_listing_status = 'archived', updated_at = now()
where public_listing_status = 'published'
  and category = 'Child-friendly cafes'
  and source_name ilike 'Google Places API%'
  and google_primary_type in ('bar', 'pub');
