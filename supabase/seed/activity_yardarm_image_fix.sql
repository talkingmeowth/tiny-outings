-- Use Yardarm's own interior and bakery photo for the activity card.
update public.activities
set
  image_url = 'https://yardarm.london/cdn/shop/files/Yardarm_Interior_02_2048x2048.jpg?v=1613795930',
  image_source_url = 'https://www.yardarm.london/',
  updated_at = now()
where activity_id = 'f336d652-a7dd-4087-a56a-d50b1ac00196';
