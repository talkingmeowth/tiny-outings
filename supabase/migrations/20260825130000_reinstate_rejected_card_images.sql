-- Reinstate card images retained by the full image audit. Keep the unsuitable
-- assessment and original-source fields intact so the review history remains
-- available, while deliberately promoting the retained image into the active
-- audit slot requested by the administrator.
update public.activities
set
  audit_image_url = nullif(trim(audit_image_original_url), ''),
  audit_image_source_url = coalesce(
    nullif(trim(audit_image_source_url), ''),
    nullif(trim(audit_image_original_url), '')
  )
where audit_image_status in ('needs_replacement', 'no_replacement')
  and nullif(trim(audit_image_url), '') is null
  and nullif(trim(audit_image_original_url), '') is not null;
