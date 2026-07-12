-- Fever's live ticket calendar currently lists daily availability from 13 July
-- through 31 August 2026. Keep the import date-specific so it cannot appear
-- outside the published booking window.
UPDATE public.activities
SET
  available_dates = ARRAY(
    SELECT generate_series('2026-07-13'::date, '2026-08-31'::date, interval '1 day')::date
  ),
  availability_start_date = '2026-07-13',
  availability_end_date = '2026-08-31',
  availability_type = 'specific_dates',
  availability_notes = 'Fever ticket calendar lists daily availability from 13 July to 31 August 2026. Monday-Thursday: 10 AM-7 PM | Friday & Public Holidays: 10 AM-8 PM | Saturday: 9 AM-8 PM | Sunday: 9 AM-7 PM. Last slot starts 75 minutes before closing.',
  updated_at = now()
WHERE activity_id = '84cb8a17-4670-48ac-969e-d7a9297db3bc';
