-- Avoid full-resolution Commons originals on mobile activity cards.
with original_images as (
  select
    activity_id,
    regexp_replace(
      wikimedia_image_url,
      '^(https://upload\\.wikimedia\\.org/wikipedia/commons)/([^/]+)/([^/]+)/([^/]+)$',
      E'\\1/thumb/\\2/\\3/\\4/640px-\\4'
    ) as thumbnail_url
  from public.activities
  where wikimedia_image_url ~ '^https://upload\\.wikimedia\\.org/wikipedia/commons/[^/]+/[^/]+/[^/]+$'
)
update public.activities as activity
set wikimedia_image_url = original_images.thumbnail_url,
    updated_at = now()
from original_images
where activity.activity_id = original_images.activity_id;
