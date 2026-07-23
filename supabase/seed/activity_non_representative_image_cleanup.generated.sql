-- Footer straplines and other navigation artwork are not suitable card imagery.
-- The mobile client uses its category illustration when no activity image is available.
update public.activities
set
  image_url = null,
  image_source_url = null,
  updated_at = now()
where coalesce(image_url, '') ~* '(strapline|wordmark|facebook[.]com/tr|facebook[.]net/tr|facebook[.](png|jpg|jpeg|webp)|tracking-pixel|/pixel[.]|pixel[.]gif)';
