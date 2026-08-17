-- Keep the cafe filter focused on places that are suitable for parents and
-- young children. These records match prior editorial archive decisions: they
-- are bars, liquor stores, or animal-only venues rather than family cafes.
-- Retain the rows for audit and importer deduplication; hide them from the app.
update public.activities
set archive = true,
    public_listing_status = 'archived',
    updated_at = now()
where archive = false
  and public_listing_status = 'published'
  and category = 'Child-friendly cafes'
  and (
    google_primary_type in ('bar', 'bar_and_grill', 'dog_cafe', 'pub', 'night_club', 'casino', 'liquor_store')
    or lower(trim(activity_name)) in (
      'goods office',
      'park brew and kitchen',
      'cuppapug',
      'stone mini market',
      'yardarm'
    )
  );
