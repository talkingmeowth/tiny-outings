alter table public.activities
  add column if not exists scraped_image_url text;

comment on column public.activities.scraped_image_url is
  'Preferred representative image extracted from an activity or organiser listing page.';
