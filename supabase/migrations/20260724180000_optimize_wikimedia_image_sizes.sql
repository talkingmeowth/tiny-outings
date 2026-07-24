-- Wikimedia thumbnail URLs support predictable width variants. A 640px image
-- remains sharp on a mobile card while downloading far less data than 1280px.
update public.activities
set
  wikimedia_image_url = replace(wikimedia_image_url, '/1280px-', '/640px-'),
  updated_at = now()
where wikimedia_image_url like '%/1280px-%';
