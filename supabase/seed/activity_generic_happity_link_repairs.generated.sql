with detail_links (activity_id, detail_url) as (
  values
    ('8307371a-99b3-45a8-b0df-07f86d2d81f7'::uuid, 'https://www.happity.co.uk/schedules/mums-art-club-london-the-quaker-meeting-house-mums-art-club'::text),
    ('32fbc3d0-59ed-4860-baec-bd8a4c4f3289'::uuid, 'https://www.happity.co.uk/schedules/wee-movers-london-good-shepherd-studios-baby-dance-by-wee-movers'::text),
    ('02c0e686-a0b5-402e-94d7-5fb6eed1e07d'::uuid, 'https://www.happity.co.uk/schedules/monkey-music-london-st-mary-s-church-rock-n-roll-wednesdays-11-30-12-00'::text),
    ('0d8c0d48-f0d0-4f5d-971f-1f177c8d52da'::uuid, 'https://www.happity.co.uk/schedules/monkey-music-london-st-mary-s-church-rock-n-roll'::text),
    ('02b81d99-5488-42e3-a191-21498db9896f'::uuid, 'https://www.happity.co.uk/schedules/music-tree-london-music-tree-first-steps-in-music-18-36-thursdays-10-15-11-00'::text),
    ('cc1cfc66-86cd-4066-9da0-ac1f602f5d4e'::uuid, 'https://www.happity.co.uk/schedules/singing-mamas-london-cornerstone-cafe-london-singing-mamas-newham'::text),
    ('65558959-03aa-4a9c-8328-cfd8ab335e59'::uuid, 'https://www.happity.co.uk/schedules/tta-london-n7-9dp-leaves-colours-nature-painting-workshop-tuesdays-10-00-11-00'::text),
    ('452013e8-8a4b-4687-b05b-caf05779f8cc'::uuid, 'https://www.happity.co.uk/schedules/tumble-tots-wanstead-wanstead-house-community-association-2-3-year-olds'::text)
)
update public.activities as activity
set
  website = detail_links.detail_url,
  updated_at = now()
from detail_links
where activity.activity_id = detail_links.activity_id;
