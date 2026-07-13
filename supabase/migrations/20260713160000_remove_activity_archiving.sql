-- The directory should never hide records behind an archive state. Entries that
-- fail the family-suitability review are removed; valid listings remain public.
delete from public.activities
where public_listing_status = 'archived'
  and (
    data_source = 'fever'
    or activity_name = 'Relax Bar Cafe'
  );

update public.activities
set public_listing_status = 'published',
    updated_at = now()
where public_listing_status = 'archived';

alter table public.activities
  drop constraint if exists activities_public_listing_status_check;

alter table public.activities
  add constraint activities_public_listing_status_check
  check (public_listing_status in ('draft', 'published'));
