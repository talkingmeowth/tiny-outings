-- A single venue can host many distinct activities, so Google Place IDs must be reusable.
drop index if exists public.activities_google_place_id_unique_idx;

create index if not exists activities_google_place_id_idx
  on public.activities (google_place_id)
  where google_place_id is not null;
