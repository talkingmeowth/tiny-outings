-- Keep Tiny Outings focused on activities for babies, children and families
-- with children. Retain antenatal listings in the database for audit history,
-- but hide them from the published directory.
update public.activities
set archive = true,
    public_listing_status = 'archived',
    updated_at = now()
where coalesce(archive, false) = false
  and public_listing_status = 'published'
  and (
    coalesce(activity_name, '') ilike '%antenatal%'
    or coalesce(category, '') ilike '%antenatal%'
  );
