-- Wikimedia title matching can confuse similarly named parks across countries.
-- Clear only the verified incorrect or non-representative park matches so the
-- app falls back to the activity's website/listing image instead.
update public.activities
set wikimedia_image_url = null,
    updated_at = now()
where activity_id in (
  '2b680307-7430-49dd-a127-e2f3e82476ef',
  'b7e2c8fa-8337-466e-86b4-03fdd5ee1975',
  '83a59734-a706-45c7-811a-071ef606241c',
  '33919fa0-d464-497d-bbd6-fa7382c3b72a',
  '1cc47097-3f44-40a3-a75b-ed0def47aa81',
  'afe0aeec-ff20-4fbc-b9e9-3bc6002793ce',
  '04e3d302-400c-4d75-8989-832d9b1f9c40',
  '9ec6d855-a65d-4fa1-9760-f153c2f0fd21',
  '332b011f-2650-44fe-9e98-b045d5bb53f2',
  'cb254b8a-d077-4418-9fb4-3d7979c9348f',
  '904f8254-d027-4a77-9c4b-78519551e08e',
  '5950c5af-3c98-450a-8b1a-0a5010e9766c',
  '1ec9bcd9-36df-4069-9315-550ba71d6dc6',
  '97112d1d-4e84-42e7-a4f4-7fcc2594ce98'
);

-- Verified from https://commons.wikimedia.org/wiki/Category:Leyton_Jubilee_Park
update public.activities
set wikimedia_image_url = 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/Leyton_E10_Jubilee_Park_recreation_ground.Built_on_the_site_of_a_traditional_swings_and_slides_type_playgro.jpg/1280px-Leyton_E10_Jubilee_Park_recreation_ground.Built_on_the_site_of_a_traditional_swings_and_slides_type_playgro.jpg',
    updated_at = now()
where activity_id = 'cc410efc-7733-4abd-90fd-e3f22cd06e5c';
