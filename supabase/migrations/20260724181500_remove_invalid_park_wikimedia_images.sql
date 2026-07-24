-- Remove two invalid Commons matches from the park refresh: a file icon and
-- an unrelated Acton Park in Denbighshire.
update public.activities
set wikimedia_image_url = null,
    updated_at = now()
where activity_id in (
  '83a59734-a706-45c7-811a-071ef606241c',
  '904f8254-d027-4a77-9c4b-78519551e08e'
);
