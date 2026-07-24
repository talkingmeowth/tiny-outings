-- Use Bill's own Stratford restaurant interior photo for the card.
update public.activities
set
  image_url = 'https://cdn.bills-website.co.uk/wp-content/uploads/2026/03/Stratford-1_resized.jpg',
  image_source_url = 'https://bills-website.co.uk/restaurants/stratford/',
  updated_at = now()
where activity_id = 'e1456f1a-7f22-48b8-83eb-67836067423f';
