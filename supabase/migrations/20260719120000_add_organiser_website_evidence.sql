alter table public.activities
  add column if not exists organiser_website_confidence numeric(5, 2),
  add column if not exists organiser_website_evidence_url text;

comment on column public.activities.organiser_website_confidence is
  'Confidence score from 0 to 100 for an organiser website match.';

comment on column public.activities.organiser_website_evidence_url is
  'Search result or official page used as evidence for the organiser website match.';
