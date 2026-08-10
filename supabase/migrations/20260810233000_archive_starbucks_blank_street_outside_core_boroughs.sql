-- Keep only the Starbucks and Blank Street branches in Tiny Outings' three
-- core boroughs. Archived listings remain available to administrators but are
-- excluded from the public activity feed.
update public.activities
set archive = true,
    updated_at = now()
where archive = false
  and (
    lower(activity_name) like '%starbucks%'
    or lower(activity_name) like '%blank street%'
  )
  and coalesce(trim(borough), '') not in ('Waltham Forest', 'Newham', 'Hackney');
