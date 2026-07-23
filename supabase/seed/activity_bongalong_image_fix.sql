-- Bongalong's website exposes twitter2.png as a social asset. Happity's
-- corresponding listing supplies this representative class image instead.
update public.activities
set
  image_url = 'https://happity-production.s3.amazonaws.com/uploads/company/banner/433/Bongalong_banner.jpg?v=1681409656',
  image_source_url = 'https://www.happity.co.uk/schedules/bongalong-london-the-quaker-meeting-house-under-ones-trial-session-fridays-11-00-11-45',
  updated_at = now()
where image_url ~* 'twitter[0-9_-]*[.](png|jpg|jpeg|webp)([?].*)?$'
  and coalesce(organiser_website, '') ~* 'bongalong[.]co[.]uk';
