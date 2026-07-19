-- Browsers may block HTTP images inside the HTTPS mobile app.
update public.activities
set
  image_url = regexp_replace(image_url, '^http://', 'https://', 'i'),
  updated_at = now()
where image_url ~* '^http://';
