-- Replace legacy borough-directory anchors with verified Happity schedule pages.
-- Retire records for which Happity no longer exposes a matching individual page,
-- rather than routing families to an unrelated listing.
with website_repairs (activity_id, website) as (
  values
    ('f14cb658-364c-4eef-9c7f-be8d1d9fb8b6'::uuid, 'https://www.happity.co.uk/schedules/mother-more-leyton-pause-baby-massage-course-wednesdays-13-00-13-45-mother-more-leyton-pause-baby-massage-course-wednesdays-13-00-13-45-2-2'::text),
    ('d392d154-e4c4-44a0-b994-9c0b50d09fc1'::uuid, 'https://www.happity.co.uk/schedules/bongalong-highams-park-highams-park-baptist-church-bongalong-under-fives-trial-session'::text),
    ('8acd47e9-b537-4370-9816-09b1fdf38164'::uuid, 'https://www.happity.co.uk/schedules/monkey-music-london-st-george-in-the-east-jiggety-jig'::text),
    ('938a5260-c338-4ef7-bcb1-3f830404d2cb'::uuid, 'https://www.happity.co.uk/schedules/music-tree-london-music-tree-first-steps-in-music-0-36-wednesdays-11-00-11-45-music-tree-london-music-tree-first-steps-in-music-0-36-wednesdays-11-00-11-45-2-2'::text),
    ('dfb9f029-c89e-4900-929b-f62bda381651'::uuid, 'https://www.happity.co.uk/schedules/juniorstrikers-ltd-london-victoria-park-baby-strikers-football-18mths-2-5yrs-tuesdays-09-40-10-10-juniorstrikers-ltd-london-victoria-park-baby-strikers-football-18mths-2-5yrs-tuesdays-09-40-10-10-2-2'::text),
    ('13e5721b-0be3-4d4b-a456-06d66f5a9942'::uuid, 'https://www.happity.co.uk/schedules/walthamstow-toy-library-and-play-centre-london-walthamstow-toy-library-sensory-room-session'::text),
    ('98f90426-165d-4ef5-a81f-7dcedb56fdef'::uuid, 'https://www.happity.co.uk/schedules/blossom-babies-london-poplar-union-blossom-toddler-very-active-crawlers-walkers-up-to-36-months'::text),
    ('0c9d1cdf-c339-429b-bf3f-b0590f5036eb'::uuid, 'https://www.happity.co.uk/schedules/mother-more-london-bridgets-asl-and-chobham-manor-community-centre-baby-massage-baby-yoga-course-stage-2'::text)
), repaired as (
  update public.activities as activity
  set website = website_repairs.website,
      updated_at = now()
  from website_repairs
  where activity.activity_id = website_repairs.activity_id
  returning activity.activity_id
), archived as (
  update public.activities
  set archive = true,
      public_listing_status = 'archived',
      updated_at = now()
  where activity_id in (
    'd69ff8a0-d8e9-4906-964e-5dca845f3b84'::uuid,
    '1711b152-5a19-4368-9055-ddf0b8787db2'::uuid,
    '89b37dc5-1d7c-4dfe-be2e-e7eb98673b16'::uuid
  )
    and website ilike '%happity.co.uk/%'
    and website not ilike '%happity.co.uk/schedules/%'
  returning activity_id
)
select (select count(*) from repaired) as repaired,
       (select count(*) from archived) as archived;
