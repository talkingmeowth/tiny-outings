-- Parks are self-guided outings, so do not show external venue or organiser
-- links on their activity cards and detail screens.
update public.activities
set
  website = null,
  organiser_website = null,
  updated_at = now()
where category = 'Parks & outdoor play'
  and (website is not null or organiser_website is not null);
