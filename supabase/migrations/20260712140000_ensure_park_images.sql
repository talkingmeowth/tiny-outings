-- Some small playgrounds do not expose a Google Places or venue-site photo.
-- Use the app's dedicated park visual so every park card remains image-led.
update public.activities
set
  image_url = '/images/park-placeholder.svg',
  image_source_url = 'Tiny Outings park image fallback',
  updated_at = now()
where public_listing_status = 'published'
  and category = 'Parks & outdoor play'
  and image_url is null
  and google_photo_url is null;
