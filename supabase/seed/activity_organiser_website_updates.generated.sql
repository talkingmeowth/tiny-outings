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

update public.activities
set
  organiser_website = 'https://musictreeuk.com/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/music-tree-%';

update public.activities
set
  organiser_website = 'https://www.minimozart.com/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/mini-mozart-%';

update public.activities
set
  organiser_website = 'https://www.babysensory.com/hackney',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/baby-sensory-%'
  and borough = 'Hackney';

update public.activities
set
  organiser_website = 'https://alittledramatic.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/a-little-dramatic-%';

update public.activities
set
  organiser_website = 'https://www.acsdance.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/acs-dance-centre-%';

update public.activities
set
  organiser_website = 'https://www.monkeymusic.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/monkey-music-%';

update public.activities
set
  organiser_website = 'https://www.olivekanedance.com/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/olive-kane-dance-%';

update public.activities
set
  organiser_website = 'https://bongalong.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/bongalong-%';

update public.activities
set
  organiser_website = 'https://www.fefefanclub.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/fe-fe-fanclub-%';

update public.activities
set
  organiser_website = 'https://www.thepetiteperformers.com/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/petite-performers-%';

update public.activities
set
  organiser_website = 'https://littlestrikers.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/little-strikers-%';

update public.activities
set
  organiser_website = 'https://www.lgacademy.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/lisa-gilbert-academy-of-ballet-and-performing-arts-%';

update public.activities
set
  organiser_website = 'https://www.miniathletics.com/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/mini-athletics-%';

update public.activities
set
  organiser_website = 'https://thetogetherproject.org.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/the-together-project-%';

-- Independently verified provider links from the public web.
update public.activities
set
  organiser_website = 'https://www.babbu.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/babbu-%';

update public.activities
set
  organiser_website = 'https://linktr.ee/thecastleplayspace',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/the-castle-play-space-cic-%';

update public.activities
set
  organiser_website = 'https://www.rainforestsoftplay.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/rainforest-%';

update public.activities
set
  organiser_website = 'https://www.soccerdays.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/soccerdays-%';

update public.activities
set
  organiser_website = 'https://www.kiddikicks.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/kiddikicks-%';

update public.activities
set
  organiser_website = 'https://www.hartbeeps.com/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/hartbeeps-%';

update public.activities
set
  organiser_website = 'https://www.kidslingo.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/kidslingo-%';

update public.activities
set
  organiser_website = 'https://www.adventurebabies.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/adventure-babies-%';

update public.activities
set
  organiser_website = 'https://www.babysensory.com/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/baby-sensory-%';

update public.activities
set
  organiser_website = 'https://babyballet.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/baby-ballet-%';

update public.activities
set
  organiser_website = 'https://singandsign.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/sing-and-sign-%';

update public.activities
set
  organiser_website = 'https://www.tumbletots.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/tumble-tots-%';

update public.activities
set
  organiser_website = 'https://foxesclub.com/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/foxes-club-%';

update public.activities
set
  organiser_website = 'https://juniorstrikers.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/juniorstrikers-%';

update public.activities
set
  organiser_website = 'https://showkids.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/showkids-theatre-school-%';

update public.activities
set
  organiser_website = 'https://www.mwhealth.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/moon-women-s-health-%';

update public.activities
set
  organiser_website = 'https://zipzapkids.com/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/zip-zap-%';

update public.activities
set
  organiser_website = 'https://tennis-time.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/tennis-time-%';

update public.activities
set
  organiser_website = 'https://musicalminiatures.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/musical-miniatures-%';

update public.activities
set
  organiser_website = 'https://www.hackneyballet.com/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/hackney-ballet-%';

update public.activities
set
  organiser_website = 'https://www.cbcd.bbk.ac.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/birkbeck-babylab-toddlerlab-%';

update public.activities
set
  organiser_website = 'https://www.bachtobaby.com/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/bach-to-baby-%';

update public.activities
set
  organiser_website = 'https://discover.org.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/discover-children-s-story-centre-%';

update public.activities
set
  organiser_website = 'https://www.youngactors.org.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/young-actors-theatre-%';

update public.activities
set
  organiser_website = 'https://thelittledanceacademy.com/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/the-little-dance-academy-%';

update public.activities
set
  organiser_website = 'https://www.northlondongymnastics.com/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/north-london-gymanstics-%';

update public.activities
set
  organiser_website = 'https://the.nlconservatoire.org/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/north-london-conservatoire-%';

update public.activities
set
  organiser_website = 'https://wentworthchildrenscentre.co.uk/',
  updated_at = now()
where source_name = 'Happity'
  and source_url like 'https://www.happity.co.uk/schedules/wentworth-children-s-centre-%';
