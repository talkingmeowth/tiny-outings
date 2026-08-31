-- Let administrators review archived listings and deliberately restore them
-- without weakening the importer protection that normally keeps archives final.
begin;

alter table public.activities
  add column if not exists archive_previous_listing_status text;

alter table public.activities
  drop constraint if exists activities_archive_previous_listing_status_check,
  add constraint activities_archive_previous_listing_status_check check (
    archive_previous_listing_status is null
    or archive_previous_listing_status in ('draft', 'published')
  );

comment on column public.activities.archive_previous_listing_status is
  'Draft or published status recorded immediately before an administrator archives the listing. Used only for deliberate restoration.';

drop policy if exists "Admins can read archived activities" on public.activities;
create policy "Admins can read archived activities"
on public.activities
for select
using (
  (archive = true or public_listing_status = 'archived')
  and public.is_tiny_outings_admin()
);

create or replace function public.preserve_archived_activity_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Importers cannot revive an archive through an UPSERT. The narrowly scoped
  -- security-definer function below sets this transaction-local flag only for
  -- an explicit administrator restoration request.
  if (old.archive is true or old.public_listing_status = 'archived')
     and coalesce(current_setting('tiny_outings.allow_unarchive', true), '') <> 'on' then
    new.archive = true;
    new.public_listing_status = 'archived';
  end if;
  return new;
end;
$$;

create or replace function public.unarchive_activity_from_image_review(p_activity_id uuid)
returns table (
  activity_id uuid,
  public_listing_status text,
  archive boolean,
  archive_reason text,
  archived_at timestamptz,
  restored_to_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  restore_status text;
  restored_id uuid;
begin
  select case
    when activity.archive_previous_listing_status in ('draft', 'published')
      then activity.archive_previous_listing_status
    else 'draft'
  end
  into restore_status
  from public.activities as activity
  where activity.activity_id = p_activity_id
    and (activity.archive = true or activity.public_listing_status = 'archived')
  for update;

  if restore_status is null then
    raise exception 'Archived listing was not found.';
  end if;

  perform set_config('tiny_outings.allow_unarchive', 'on', true);

  update public.activities as activity
  set archive = false,
      public_listing_status = restore_status,
      archive_reason = null,
      archived_at = null,
      archive_previous_listing_status = null,
      updated_at = now()
  where activity.activity_id = p_activity_id
  returning activity.activity_id into restored_id;

  return query
  select restored_id, restore_status, false, null::text, null::timestamptz, restore_status;
end;
$$;

revoke all on function public.unarchive_activity_from_image_review(uuid) from public, anon, authenticated;
grant execute on function public.unarchive_activity_from_image_review(uuid) to service_role;

commit;
