-- Official organiser website image supplied for A1 Judo Club Happity listings.
update public.activities
set
  image_url = 'https://a1judo.com/wp-content/uploads/sites/1109/2026/07/641765865_18561270154048365_8352770841666316582_n.jpg',
  image_source_url = 'https://a1judo.com/',
  updated_at = now()
where source_name = 'Happity'
  and activity_name like 'A1 JUDO CLUB%';
