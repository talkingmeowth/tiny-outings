-- Fever omitted the locality for these two out-of-London venues. Their
-- previous Maps searches misleadingly appended London.
update public.activities
set address = 'Camberley Theatre, Camberley',
    google_link = 'https://www.google.com/maps/search/?api=1&query=Camberley%20Theatre%2C%20Camberley',
    google_place_uri = 'https://www.google.com/maps/search/?api=1&query=Camberley%20Theatre%2C%20Camberley',
    updated_at = now()
where activity_id = 'f2f907a3-50dc-406e-9eb6-19f8c1d1e147'
  and address = 'Camberley Theatre, London'
  and google_place_id is null;

update public.activities
set address = 'Ballin'' Maidstone, Maidstone',
    google_link = $$https://www.google.com/maps/search/?api=1&query=Ballin'%20Maidstone%2C%20Maidstone$$,
    google_place_uri = $$https://www.google.com/maps/search/?api=1&query=Ballin'%20Maidstone%2C%20Maidstone$$,
    updated_at = now()
where activity_id = 'd248f4da-0e02-40a0-a9cf-fb2fd5d79743'
  and address = 'Ballin'' Maidstone, London'
  and google_place_id is null;

-- Keep the two Google-link fields consistent for the other Fever searches.
update public.activities
set google_place_uri = google_link,
    updated_at = now()
where archive = false
  and source_name = 'Fever London family listings'
  and google_place_id is null
  and google_place_uri is null
  and google_link like 'https://www.google.com/maps/search/?api=1&query=%';
