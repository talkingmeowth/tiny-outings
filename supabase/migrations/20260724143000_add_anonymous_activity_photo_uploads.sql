insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'activity-photos',
  'activity-photos',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can upload activity photos" on storage.objects;

create policy "Anyone can upload activity photos"
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id = 'activity-photos'
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
);
