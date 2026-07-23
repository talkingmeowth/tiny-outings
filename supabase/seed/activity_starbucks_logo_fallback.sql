-- Starbucks store-locator pages do not consistently provide branch photography.
-- Use the official Starbucks app icon only where extraction left the card blank.
update public.activities
set
  image_url = 'https://www.starbucks.co.uk/assets/app/icons/apple-icon.png',
  image_source_url = 'https://www.starbucks.co.uk/',
  updated_at = now()
where public_listing_status = 'published'
  and activity_name ~* '\mstarbucks\M'
  and nullif(trim(image_url), '') is null;
