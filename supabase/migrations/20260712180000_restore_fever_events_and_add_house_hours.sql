-- Keep Fever records in the dataset. Listings without a structured schedule stay
-- out of day planning until Fever publishes bookable dates or opening hours.
UPDATE public.activities
SET
  public_listing_status = 'published',
  activity_date = null,
  available_dates = ARRAY[]::date[],
  availability_start_date = null,
  availability_end_date = null,
  available_days_of_week = ARRAY[]::text[],
  availability_type = 'unknown',
  availability_notes = 'Fever currently shows no live ticket calendar. Retained in the directory and excluded from day planning until availability is published.',
  updated_at = now()
WHERE activity_id = '66775102-4425-4aab-9ead-bb8500bc8620';

UPDATE public.activities
SET
  start_time = '09:00',
  end_time = '20:00',
  days_of_week = ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  schedule_notes = 'Fever opening hours: Monday-Thursday: 10 AM-7 PM | Friday & Public Holidays: 10 AM-8 PM | Saturday: 9 AM-8 PM | Sunday: 9 AM-7 PM. Last slot starts 75 minutes before closing.',
  available_days_of_week = ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  availability_type = 'daily',
  availability_notes = 'Open daily. Check Fever ticket selector for bookable dates and slots.',
  updated_at = now()
WHERE activity_id = '84cb8a17-4670-48ac-969e-d7a9297db3bc';
