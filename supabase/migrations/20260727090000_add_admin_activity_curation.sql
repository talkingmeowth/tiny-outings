-- Curated links are human-in-the-loop corrections. Keep their source separate
-- from scraped/imported data and allow only the designated administrator to edit.
alter table public.activities
  add column if not exists user_image_url text;

comment on column public.activities.user_image_url is
  'Administrator-curated activity image URL. Takes priority over imported image URLs.';

create or replace function public.is_tiny_outings_admin()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'talkingmeowth06@gmail.com';
$$;

create table if not exists public.activity_curation_feedback (
  feedback_id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(activity_id) on delete cascade,
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  data_source text,
  previous_values jsonb not null,
  updated_values jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists activity_curation_feedback_activity_idx
  on public.activity_curation_feedback (activity_id, created_at desc);

create index if not exists activity_curation_feedback_source_idx
  on public.activity_curation_feedback (data_source);

alter table public.activity_curation_feedback enable row level security;

drop policy if exists "Admins can read curation feedback" on public.activity_curation_feedback;
create policy "Admins can read curation feedback"
on public.activity_curation_feedback
for select
using (public.is_tiny_outings_admin());

drop policy if exists "Admin can update activity listings" on public.activities;
create policy "Admin can update activity listings"
on public.activities
for update
using (public.is_tiny_outings_admin())
with check (public.is_tiny_outings_admin());

create or replace function public.record_admin_activity_curation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_links jsonb;
  updated_links jsonb;
begin
  if not public.is_tiny_outings_admin() then
    return new;
  end if;

  previous_links := jsonb_build_object(
    'user_image_url', old.user_image_url,
    'website', old.website,
    'organiser_website', old.organiser_website,
    'google_link', old.google_link,
    'google_place_uri', old.google_place_uri
  );
  updated_links := jsonb_build_object(
    'user_image_url', new.user_image_url,
    'website', new.website,
    'organiser_website', new.organiser_website,
    'google_link', new.google_link,
    'google_place_uri', new.google_place_uri
  );

  if previous_links is distinct from updated_links then
    insert into public.activity_curation_feedback (
      activity_id,
      admin_user_id,
      data_source,
      previous_values,
      updated_values
    ) values (
      new.activity_id,
      auth.uid(),
      new.data_source,
      previous_links,
      updated_links
    );
  end if;

  return new;
end;
$$;

drop trigger if exists record_admin_activity_curation on public.activities;
create trigger record_admin_activity_curation
after update of user_image_url, website, organiser_website, google_link, google_place_uri
on public.activities
for each row
execute function public.record_admin_activity_curation();
