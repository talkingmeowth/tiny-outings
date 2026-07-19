alter table public.activities
  add column if not exists organiser_website text;

comment on column public.activities.organiser_website is
  'Verified official website for the activity organiser or provider. This is separate from a marketplace or source listing URL.';

create index if not exists activities_organiser_website_idx
  on public.activities (organiser_website)
  where organiser_website is not null;

-- Verified from the organiser's own site supplied for the A1 Judo listings.
update public.activities
set
  organiser_website = 'https://a1judo.com/',
  updated_at = now()
where source_name = 'Happity'
  and activity_name like 'A1 JUDO CLUB%';
