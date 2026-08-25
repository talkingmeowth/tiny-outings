-- Correct the reinstatement so retained originals live in their recorded source
-- fields. audit_image_url and audit_image_source_url are reserved exclusively
-- for replacement images selected by the audit replacement workflow.
update public.activities
set website_image_url = nullif(trim(audit_image_original_url), '')
where audit_image_status in ('needs_replacement', 'no_replacement')
  and audit_image_original_source_field = 'website_image_url'
  and nullif(trim(audit_image_original_url), '') is not null;

update public.activities
set website_downloaded_image = nullif(trim(audit_image_original_url), '')
where audit_image_status in ('needs_replacement', 'no_replacement')
  and audit_image_original_source_field = 'website_downloaded_image'
  and nullif(trim(audit_image_original_url), '') is not null;

update public.activities
set scraped_image_url = nullif(trim(audit_image_original_url), '')
where audit_image_status in ('needs_replacement', 'no_replacement')
  and audit_image_original_source_field = 'scraped_image_url'
  and nullif(trim(audit_image_original_url), '') is not null;

update public.activities
set listing_image_url = nullif(trim(audit_image_original_url), '')
where audit_image_status in ('needs_replacement', 'no_replacement')
  and audit_image_original_source_field = 'listing_image_url'
  and nullif(trim(audit_image_original_url), '') is not null;

update public.activities
set organiser_website_downloaded_image = nullif(trim(audit_image_original_url), '')
where audit_image_status in ('needs_replacement', 'no_replacement')
  and audit_image_original_source_field = 'organiser_website_downloaded_image'
  and nullif(trim(audit_image_original_url), '') is not null;

update public.activities
set image_url = nullif(trim(audit_image_original_url), '')
where audit_image_status in ('needs_replacement', 'no_replacement')
  and audit_image_original_source_field = 'image_url'
  and nullif(trim(audit_image_original_url), '') is not null;

update public.activities
set wikimedia_image_url = nullif(trim(audit_image_original_url), '')
where audit_image_status in ('needs_replacement', 'no_replacement')
  and audit_image_original_source_field = 'wikimedia_image_url'
  and nullif(trim(audit_image_original_url), '') is not null;

update public.activities
set
  audit_image_url = null,
  audit_image_source_url = null
where audit_image_status in ('needs_replacement', 'no_replacement')
  and nullif(trim(audit_image_url), '') = nullif(trim(audit_image_original_url), '');

alter table public.activities
  drop constraint if exists activities_audit_replacement_fields_check,
  add constraint activities_audit_replacement_fields_check check (
    (
      nullif(trim(audit_image_url), '') is null
      and nullif(trim(audit_image_source_url), '') is null
    )
    or audit_image_status = 'replaced'
  );
