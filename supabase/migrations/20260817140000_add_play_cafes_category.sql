-- Keep this deliberately narrow: listings named as play cafes are unambiguous.
-- Other child-friendly cafes remain in their existing category until an importer
-- supplies a clearer play-cafe signal.
update public.activities
set category = 'Play cafes',
    updated_at = now()
where coalesce(archive, false) = false
  and category in ('Child-friendly cafes', 'child friendly cafe', 'Cafes & food')
  and (
    activity_name ilike '%play cafe%'
    or activity_name ilike '%soft play% cafe%'
    or activity_name ilike '%soft play and cafe%'
  );
