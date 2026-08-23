-- Clear seven unsafe logo or generic-image replacements. They fall back to
-- the app illustration until a verified venue image is available.
update public.activities
set
  scraped_image_url = null,
  image_source_url = null,
  website_downloaded_image = null,
  organiser_website_downloaded_image = null,
  website_image_url = null,
  listing_image_url = null,
  updated_at = now()
where activity_id in (
  '0ff4e893-39eb-4f4f-b5ef-906eb08ec416'::uuid,
  '2475f7bb-0ddd-4c26-9704-827be0798813'::uuid,
  '44d74013-40b2-4f55-92c8-a07d4ef8db6d'::uuid,
  '452013e8-8a4b-4687-b05b-caf05779f8cc'::uuid,
  '477dd3bf-03df-4e1d-b156-29f8cf562dd0'::uuid,
  '6a958406-5d76-43a9-9992-c6b04b4da2a7'::uuid,
  'c95f49b9-907e-4d82-a7f0-149efeea031f'::uuid
);
