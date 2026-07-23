-- Use Happity's representative provider photo rather than Wee Movers' generic
-- blue plane graphic for all matching Wee Movers activity cards.
update public.activities
set
  image_url = 'https://happity-production.s3.amazonaws.com/uploads/company/banner/9625/Wee_Movers_banner.jpg?v=1715716435',
  image_source_url = 'https://www.happity.co.uk/schedules/wee-movers-london-crate-walthamstow-wee-movers-preschool-creative-dance',
  updated_at = now()
where activity_name ~* 'wee movers';
