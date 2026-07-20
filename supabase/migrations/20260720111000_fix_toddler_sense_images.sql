-- Replace Toddler Sense country-selector flags with its activity photograph.
update public.activities
set
  image_url = 'https://www.toddlersense.com/content/S638966730360474635/small_638967475217443297_9.png',
  image_source_url = 'https://www.toddlersense.com/',
  updated_at = now()
where organiser_website = 'https://www.toddlersense.com/';
