-- Use Baby Sensory's programme photograph, not its country-selector flag.
update public.activities
set
  image_url = 'https://www.babysensory.com/content/S636384802478713118/small_638977732371574607_31.png',
  image_source_url = 'https://www.babysensory.com/',
  updated_at = now()
where organiser_website = 'https://www.babysensory.com/';
