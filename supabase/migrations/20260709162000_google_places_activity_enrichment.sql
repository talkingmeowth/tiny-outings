alter table public.activities
  add column if not exists google_place_id text,
  add column if not exists google_place_uri text,
  add column if not exists google_photo_url text,
  add column if not exists google_rating numeric(3, 2) check (
    google_rating is null
    or google_rating between 0 and 5
  ),
  add column if not exists google_user_rating_count integer check (
    google_user_rating_count is null
    or google_user_rating_count >= 0
  ),
  add column if not exists google_primary_type text,
  add column if not exists google_opening_hours jsonb,
  add column if not exists google_summary text;

create unique index if not exists activities_google_place_id_unique_idx
  on public.activities (google_place_id)
  where google_place_id is not null;

create index if not exists activities_google_primary_type_idx
  on public.activities (google_primary_type);

comment on column public.activities.google_place_id is
  'Google Places API place id used for refreshing official place details.';

comment on column public.activities.google_photo_url is
  'Short-lived or cached Google Places photo media URL returned by the activity-link-autofill Edge Function.';

delete from public.activities
where public_listing_status in ('draft', 'archived')
  and (
    coalesce(source_name, '') ~* '(demo|sample|fake)'
    or coalesce(source_url, '') ~* '(demo|sample|fake|local-)'
  );

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_user_name text;
  display_name_from_provider text;
  avatar_from_provider text;
begin
  display_name_from_provider := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(new.raw_user_meta_data ->> 'user_name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), '')
  );

  avatar_from_provider := coalesce(
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(new.raw_user_meta_data ->> 'picture', '')
  );

  requested_user_name := lower(
    regexp_replace(
      coalesce(
        nullif(new.raw_user_meta_data ->> 'user_name', ''),
        nullif(new.raw_user_meta_data ->> 'userName', ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'parent'
      ),
      '[^A-Za-z0-9_.]',
      '_',
      'g'
    )
  );

  requested_user_name := left(requested_user_name, 21) || '_' || replace(left(new.id::text, 8), '-', '');

  insert into public.user_table (user_id, user_name, display_name, avatar_url)
  values (
    new.id,
    requested_user_name,
    display_name_from_provider,
    avatar_from_provider
  )
  on conflict (user_id) do update
  set
    display_name = coalesce(public.user_table.display_name, excluded.display_name),
    avatar_url = coalesce(public.user_table.avatar_url, excluded.avatar_url);

  return new;
end;
$$;
