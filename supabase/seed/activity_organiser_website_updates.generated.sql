-- Verified official organiser websites discovered through web search.
-- Keep these separate from Happity listing URLs, which remain in source_url and website.

update public.activities
set
  organiser_website = 'https://www.adrenalindance.com/',
  updated_at = now()
where source_name = 'Happity'
  and activity_name like 'ADRENALIN DANCE PRODUCTIONS%';

update public.activities
set
  organiser_website = 'https://www.angelinajandolodance.com/',
  updated_at = now()
where source_name = 'Happity'
  and activity_name like 'ANGELINA JANDOLO DANCE%';

update public.activities
set
  organiser_website = 'https://www.animolondon.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and activity_name like 'ANIMO POSTNATAL%';
