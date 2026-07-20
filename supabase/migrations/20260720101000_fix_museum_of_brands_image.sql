-- Replace a Fever interface graphic with an official Museum of Brands collection image.
update public.activities
set
  image_url = 'https://museumofbrands.com/wp-content/uploads/2023/07/Time_Tunnel_Thumbnail_Back.jpg',
  image_source_url = 'https://museumofbrands.com/',
  updated_at = now()
where activity_id = '2b2dca17-6b73-47c6-9582-183c2008b7d1'::uuid;
