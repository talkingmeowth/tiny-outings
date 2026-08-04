-- Derived from the current Happity schedule snapshots by
-- scripts/audit-happity-website-links.js. These rows previously pointed to
-- borough-directory anchors rather than an individual activity schedule.
with website_repairs (activity_id, website) as (
  values
    ('6a958406-5d76-43a9-9992-c6b04b4da2a7'::uuid, 'https://www.happity.co.uk/schedules/the-castle-play-space-cic-london-the-castle-play-space-the-castle-stay-and-play-tuesdays-09-30-11-00-the-castle-play-space-cic-london-the-castle-play-space-the-castle-stay-and-play-tuesdays-09-30-11-00-2-2'::text),
    ('84f478f6-3f88-45a4-82cb-d73e1f92261e'::uuid, 'https://www.happity.co.uk/schedules/little-movers-gym-london-gracepoint-little-movers-gym-mondays-09-30-10-30'::text),
    ('de8d2237-fb53-40ac-aa83-9e1f0262a09b'::uuid, 'https://www.happity.co.uk/schedules/little-movers-gym-london-gracepoint-little-movers-gym-wednesdays-09-30-10-30'::text),
    ('e7e6c03c-bd10-4818-8e9f-d0d6f40eb3c6'::uuid, 'https://www.happity.co.uk/schedules/kids-at-play-london-the-ramsay-scout-centre-sense-stories-by-kids-at-play'::text),
    ('aa673217-63f0-4a7b-a93b-66227a871b42'::uuid, 'https://www.happity.co.uk/schedules/kids-at-play-london-the-ramsay-scout-centre-0-6-months-sensory-class'::text),
    ('c27c9b2a-7940-4983-a59e-f10af63fb677'::uuid, 'https://www.happity.co.uk/schedules/mini-mozart-london-st-mary-s-church-mini-mozart-baby-class'::text),
    ('ad17374a-9492-464d-ba3b-073f55862e14'::uuid, 'https://www.happity.co.uk/schedules/lisa-gilbert-academy-of-ballet-and-performing-arts-london-oxford-house-bethnal-green-pre-school-acro-gymnastics'::text),
    ('68ed68dd-1f24-45a6-b22b-84e27bb52276'::uuid, 'https://www.happity.co.uk/schedules/sing-and-sign-islington-st-mary-s-neighbourhood-centre-stage-1-baby-signing-music-class-6-14m-mondays-10-00-10-40'::text),
    ('f3180475-3bc7-4956-8dc6-fcad8b6c34cb'::uuid, 'https://www.happity.co.uk/schedules/flying-sycamores-forest-school-london-good-shepherd-studios-forest-school-sessions-good-shepherd-studios'::text),
    ('684ff48b-09db-470f-af80-2ca967ca1962'::uuid, 'https://www.happity.co.uk/schedules/zip-zap-london-st-mary-s-church-stoke-newington-zip-zap-toddlers'::text),
    ('0fe267ff-4435-4f2d-be0b-22b01d228da8'::uuid, 'https://www.happity.co.uk/schedules/thula-mama-london-yonder-studio-e17-thula-mama-singing-with-babies-wednesdays-10-00-11-00'::text),
    ('7baaec93-0e58-462d-b7ff-cdb38c4d53e5'::uuid, 'https://www.happity.co.uk/schedules/tick-tock-music-london-st-stephen-s-canonbury-tick-tock-music-mondays-09-45-10-30-tick-tock-music-london-st-stephen-s-canonbury-tick-tock-music-mondays-09-45-10-30-3-3'::text)
)
update public.activities as activity
set website = website_repairs.website, updated_at = now()
from website_repairs
where activity.activity_id = website_repairs.activity_id;
