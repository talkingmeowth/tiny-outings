-- Keep a cafe's Google Maps URL only when no independent organiser site is known.
update public.activities
set
  website = organiser_website,
  updated_at = now()
where lower(coalesce(category, '')) like '%cafe%'
  and coalesce(website, '') ilike '%google%'
  and nullif(btrim(organiser_website), '') is not null
  and organiser_website not ilike '%google%';
