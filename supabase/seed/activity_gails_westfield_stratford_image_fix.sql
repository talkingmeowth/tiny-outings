-- The official location page exposes this branch-specific bakery photo.
update public.activities
set
  image_url = 'https://gails.com/cdn/shop/files/Westfield_Stratford.jpg?v=1775730617',
  image_source_url = 'https://gails.com/pages/westfield-stratford',
  updated_at = now()
where activity_id = '857cb8d8-d5f5-4af3-855c-e56d7a528926';
