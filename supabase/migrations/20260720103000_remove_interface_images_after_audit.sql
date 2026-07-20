-- Interface and download-button graphics are not meaningful activity images.
-- Let the app's category illustration render when no suitable website image exists.
update public.activities
set
  image_url = null,
  image_source_url = null,
  updated_at = now()
where image_url ~* '(google-play|google_play|app-store|app_store|facebook[.]com/tr|doubleclick|[.]svg(?:[?#]|$))';

-- Prefer the museum's own Time Tunnel collection image over a generic ticketing listing image.
update public.activities
set
  image_url = 'https://museumofbrands.com/wp-content/uploads/2023/07/Time_Tunnel_Thumbnail_Back.jpg',
  image_source_url = 'https://museumofbrands.com/',
  updated_at = now()
where activity_id = '2b2dca17-6b73-47c6-9582-183c2008b7d1'::uuid;
