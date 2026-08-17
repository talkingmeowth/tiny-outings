-- A generic Google Place for a library is a venue, not a child-focused
-- activity. Library-run sessions remain available through their specialist
-- event importers, but generic directory entries should not appear in swiping.
update public.activities
set archive = true,
    updated_at = now()
where source_name = 'Google Places API'
  and lower(category) = 'library'
  and coalesce(archive, false) = false;
