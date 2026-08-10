-- The first administrator submission was saved as a draft before the admin
-- publish policy existed. Fill its known Tun venue details and publish it.
update public.activities
set activity_name = 'Tun Cafe',
    address = '140 Tilbury Rd, London E10 6RE',
    lat = 51.570597,
    long = -0.009784,
    website = 'https://www.instagram.com/tunspacee10/',
    organiser_website = 'https://www.instagram.com/tunspacee10/',
    public_listing_status = 'published',
    archive = false,
    updated_at = now()
where activity_id = 'aa202017-78da-44f4-8076-2c8beeb5e142'::uuid;
