-- The April-August 2026 PDF is re-parsed line-by-line to avoid cross-row fields.
-- Archive older extracts before loading the corrected generated seed.
update public.activities
set public_listing_status = 'archived', updated_at = now()
where source_name = 'Waltham Forest Best Start in Life timetable';
