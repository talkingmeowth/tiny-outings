with detail_links (activity_id, detail_url) as (
  values
    ('cc1cfc66-86cd-4066-9da0-ac1f602f5d4e'::uuid, 'https://www.happity.co.uk/schedules/singing-mamas-london-cornerstone-cafe-london-singing-mamas-newham'::text),
    ('8307371a-99b3-45a8-b0df-07f86d2d81f7'::uuid, 'https://www.happity.co.uk/schedules/mums-art-club-london-the-quaker-meeting-house-mums-art-club'::text),
    ('65558959-03aa-4a9c-8328-cfd8ab335e59'::uuid, 'https://www.happity.co.uk/schedules/tta-london-n7-9dp-leaves-colours-nature-painting-workshop-tuesdays-10-00-11-00'::text)
)
update public.activities as activity
set website = detail_links.detail_url, updated_at = now()
from detail_links
where activity.activity_id = detail_links.activity_id;
