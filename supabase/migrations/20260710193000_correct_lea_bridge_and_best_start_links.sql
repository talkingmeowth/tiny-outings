-- Better Start rows should open their own timetable reference, not the generic council events landing page.
update public.activities
set website = source_url
where source_name = 'Waltham Forest Best Start in Life timetable'
  and source_url is not null
  and website = 'https://www.walthamforest.gov.uk/events';

-- The earlier Places enrichment matched an address near Lea Bridge Library rather than the library itself.
-- Use the official Google Places venue and the council's published E10 7HU address for every listing at this venue.
update public.activities
set
  address = 'Lea Bridge Library, Lea Bridge Road, London E10 7HU',
  lat = 51.570776,
  long = -0.023628,
  google_link = 'https://maps.google.com/?cid=15028814885973325979',
  google_place_id = 'ChIJd7ScnL0ddkgRm_iKQYMTkdA',
  google_place_uri = 'https://maps.google.com/?cid=15028814885973325979',
  google_primary_type = 'library',
  google_photo_url = null
where activity_name ilike '%Lea Bridge Library%';
