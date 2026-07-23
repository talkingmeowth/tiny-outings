-- Happity lists these sessions at Round Chapel Old School Rooms, 2 Powerscroft Road, E5 0PU.
update public.activities
set
  address = 'Round Chapel Old School Rooms, 2 Powerscroft Road, London, E5 0PU',
  postcode = 'E5 0PU',
  lat = 51.5524959,
  long = -0.0519159,
  google_link = 'https://www.google.com/maps/search/?api=1&query=Round%20Chapel%20Old%20School%20Rooms%2C%202%20Powerscroft%20Road%2C%20London%2C%20E5%200PU',
  google_place_uri = 'https://www.google.com/maps/search/?api=1&query=Round%20Chapel%20Old%20School%20Rooms%2C%202%20Powerscroft%20Road%2C%20London%2C%20E5%200PU',
  google_place_id = null,
  updated_at = now()
where activity_id in (
  '23af2eb3-baf3-45f9-8b09-2609441ac24e'::uuid,
  '0f6d7fae-54e9-4875-83d5-8c222955e459'::uuid,
  '75eab9fa-6c16-41a5-bcfb-c3de66aa21a9'::uuid
);
