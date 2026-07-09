alter table public.activities
  add column if not exists image_url text,
  add column if not exists image_source_url text;

alter table public.user_table
  add column if not exists username_completed boolean not null default false;

comment on column public.activities.image_url is
  'Preferred card image URL. Use Google Places photo URL first, then a relevant website/Open Graph image.';

comment on column public.activities.image_source_url is
  'Source page for image_url, such as Google Places or the activity website.';

comment on column public.user_table.username_completed is
  'True once the user has chosen a username inside Tiny Outings after Google sign-in.';

update public.activities
set
  image_url = coalesce(image_url, google_photo_url),
  image_source_url = coalesce(image_source_url, google_place_uri, google_link, website, source_url)
where google_photo_url is not null
   or image_source_url is null;

update public.user_table
set username_completed = true
where username_completed = false
  and user_name !~* '_[0-9a-f]{8}$';
