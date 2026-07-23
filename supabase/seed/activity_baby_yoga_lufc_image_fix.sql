-- Happity provides the official Baby Yoga at LUFC class graphic, which is
-- clearer and more representative than the organiser site's blurred thumbnail.
update public.activities
set
  image_url = 'https://happity-production.s3.amazonaws.com/uploads/company/logo/11560/event_Baby_Yoga_at_LUFC_logo.png?v=1757943347',
  image_source_url = 'https://www.happity.co.uk/schedules/baby-yoga-at-lufc-london-leytonstone-united-free-church-baby-yoga-at-lufc',
  updated_at = now()
where activity_id = '477dd3bf-03df-4e1d-b156-29f8cf562dd0';
