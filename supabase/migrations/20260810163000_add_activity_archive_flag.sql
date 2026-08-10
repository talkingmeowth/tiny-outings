-- Archived listings remain auditable but are never served to the public app.
alter table public.activities
  add column if not exists archive boolean not null default false;

create index if not exists activities_archive_idx
  on public.activities(archive)
  where archive = false;

drop policy if exists "Published activities are readable" on public.activities;
drop policy if exists "Published unarchived activities are readable" on public.activities;
create policy "Published unarchived activities are readable"
on public.activities
for select
using (public_listing_status = 'published' and archive = false);

create or replace function public.archive_tiny_outings_activity(target_activity_id uuid)
returns public.activities
language plpgsql
security definer
set search_path = public
as $$
declare
  archived_activity public.activities;
begin
  if not public.is_tiny_outings_admin() then
    raise exception 'Only Tiny Outings administrators can archive listings';
  end if;

  update public.activities
  set archive = true, updated_at = now()
  where activity_id = target_activity_id
  returning * into archived_activity;

  if not found then
    raise exception 'Listing not found';
  end if;

  return archived_activity;
end;
$$;

revoke all on function public.archive_tiny_outings_activity(uuid) from public;
grant execute on function public.archive_tiny_outings_activity(uuid) to authenticated;
