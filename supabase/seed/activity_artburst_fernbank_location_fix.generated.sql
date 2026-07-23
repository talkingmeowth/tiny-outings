-- Artburst confirms this class takes place at Fernbank Children's Centre.
-- Keep Happity as the source link, but direct the user-facing website link to
-- the organiser's specific event page rather than a directory page.
update public.activities
set
  address = 'Fernbank Children''s Centre, 1A Fountayne Road, London, N16 7EA',
  postcode = 'N16 7EA',
  lat = 51.564807,
  long = -0.064878,
  website = 'https://artburst.co.uk/event/artburst-boogie-at-fernbank-childrens-centre-hackney/',
  source_url = 'https://www.happity.co.uk/schedules/artburst-london-fernbank-family-hub-boogie-at-fernbank',
  organiser_website = 'https://artburst.co.uk/',
  google_link = 'https://www.google.com/maps/search/?api=1&query=Fernbank%20Children%27s%20Centre%2C%201A%20Fountayne%20Road%2C%20London%20N16%207EA',
  google_place_uri = 'https://www.google.com/maps/search/?api=1&query=Fernbank%20Children%27s%20Centre%2C%201A%20Fountayne%20Road%2C%20London%20N16%207EA',
  google_place_id = null,
  google_rating = null,
  google_user_rating_count = null,
  google_primary_type = null,
  google_opening_hours = null,
  google_summary = null,
  booking_required = false,
  updated_at = now()
where activity_id = '73dc0282-a359-4f00-920c-c8b534d68f0a'::uuid;
