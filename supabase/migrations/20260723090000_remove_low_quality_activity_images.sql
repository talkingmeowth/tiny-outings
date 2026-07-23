-- Remove social icons and deliberately tiny image variants from activity cards.
-- The app renders a category illustration while a suitable activity photo is absent.
update public.activities
set
  image_url = null,
  image_source_url = null,
  updated_at = now()
where coalesce(image_url, '') ~* '(facebook[.](png|jpg|jpeg|webp)|/small_|150x150|200x200|s200x200)';
