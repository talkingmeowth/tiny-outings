-- Corrected from the live Happity Children's Playroom listing.
update public.activities
set
  address = $$The Mill (Community Centre), 7-11 Coppermill Lane, London, Greater London, E17 7HA$$,
  lat = 51.581093,
  long = -0.035973,
  google_link = $$https://www.google.com/maps/search/?api=1&query=The%20Mill%20(Community%20Centre)%2C%207-11%20Coppermill%20Lane%2C%20London%20E17%207HA$$,
  google_place_id = null,
  google_place_uri = null,
  image_url = $$https://happity-production.s3.amazonaws.com/uploads/company/banner/3332/The_Mill_banner.jpg?v=1681411267$$,
  image_source_url = $$https://www.happity.co.uk/schedules/the-mill-london-the-mill-community-centre-children-s-playroom$$,
  updated_at = now()
where activity_id in ($$a1c4cd6f-eda3-4663-9f8f-2e62c43fcb57$$::uuid, $$03fe4f01-1c60-48b8-9243-8071ee06bc10$$::uuid, $$1ad53261-f49f-4780-8d4b-24dc9c32fbd4$$::uuid, $$d891af80-4cf6-477e-baf0-ab4f3e7a1870$$::uuid, $$0e3ee06f-3189-4b2b-939b-17d37b90158b$$::uuid, $$5a8b5f4a-41c1-4930-9f81-d808ccc1c320$$::uuid);
