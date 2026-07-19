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

update public.activities
set
  organiser_website = 'https://www.freedomfightersarts.com/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/freedom-fighters-arts-%';

update public.activities
set
  organiser_website = 'https://littlemoversgym.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/little-movers-gym-%';

update public.activities
set
  organiser_website = 'https://www.walthamstowtoylibrary.org/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/walthamstow-toy-library-and-play-centre-%';

update public.activities
set
  organiser_website = 'https://regalballet.com/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/regal-ballet-%';

update public.activities
set
  organiser_website = 'https://lyricdance.com/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/lyric-dance-and-performing-arts-school-%';

update public.activities
set
  organiser_website = 'https://www.perform.org.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/perform-%';
