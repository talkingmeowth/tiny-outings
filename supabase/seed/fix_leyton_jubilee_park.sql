-- Correct the existing Google Places park listing with the official council source.
UPDATE public.activities
SET
  website = 'https://www.walthamforest.gov.uk/libraries-arts-parks-and-leisure/parks-and-open-spaces/leyton-jubilee-park',
  source_url = 'https://www.walthamforest.gov.uk/libraries-arts-parks-and-leisure/parks-and-open-spaces/leyton-jubilee-park',
  source_name = 'Waltham Forest Council parks directory',
  data_source = 'local_directory',
  description = 'Waltham Forest''s largest park, with a pirate-ship play area, outdoor gym, nature trails, woodland walk, football pitches and KuKooLaLa cafe. Great for pram walks, outdoor play and picnics.',
  available_days_of_week = ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  availability_type = 'daily',
  availability_notes = 'Park grounds are available daily. Cafe opening hours may vary.'
WHERE activity_id = 'cc410efc-7733-4abd-90fd-e3f22cd06e5c';
