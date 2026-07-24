-- Verified against Commons file 5851654: Playground, London Fields, E8.
with image_updates (activity_id, wikimedia_image_url) as (
  values
    ('a237f4ac-ba11-4234-aa99-7d84d1dc067a'::uuid, 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c0/Playground%2C_London_Fields%2C_E8_-_geograph.org.uk_-_5851654.jpg/960px-Playground%2C_London_Fields%2C_E8_-_geograph.org.uk_-_5851654.jpg'::text),
    ('454ed67d-cec6-4845-af6d-550e6ff1eaa2'::uuid, 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c0/Playground%2C_London_Fields%2C_E8_-_geograph.org.uk_-_5851654.jpg/960px-Playground%2C_London_Fields%2C_E8_-_geograph.org.uk_-_5851654.jpg'::text),
    ('818a7145-772a-44c8-8684-1be8321300d7'::uuid, 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c0/Playground%2C_London_Fields%2C_E8_-_geograph.org.uk_-_5851654.jpg/960px-Playground%2C_London_Fields%2C_E8_-_geograph.org.uk_-_5851654.jpg'::text)
)
update public.activities as activity
set wikimedia_image_url = image_updates.wikimedia_image_url,
    updated_at = now()
from image_updates
where activity.activity_id = image_updates.activity_id;
