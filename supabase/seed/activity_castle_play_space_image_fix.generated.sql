-- Replace Linktree's generic preview with a real Castle Play Space activity image
-- published by the organiser on its linked Facebook page.
UPDATE public.activities
SET
  image_url = 'https://scontent-lhr11-1.xx.fbcdn.net/v/t39.30808-6/564184670_122129102828956554_8342545195573448851_n.jpg?stp=dst-jpg_tt6&cstp=mx1080x1350&ctp=s1080x1350&_nc_cat=100&ccb=1-7&_nc_sid=833d8c&_nc_ohc=5FPs8AH0oXsQ7kNvwH-hNuz&_nc_oc=AdruFEVl8qG2z_J66mvY8EkqwJTbmz6SVrlvjDHbWhwRnisDuLfYWBZmqULhZgxyP3M&_nc_zt=23&_nc_ht=scontent-lhr11-1.xx&_nc_gid=jWdhh78EPM49PdhWDgY2Qw&_nc_ss=7b289&oh=00_AQDe6pUezqAA54sFdD6FBh9AWwiWwIpHRGV9s_WjD47zIA&oe=6A68634A',
  organiser_website = COALESCE(organiser_website, 'https://linktr.ee/thecastleplayspace'),
  updated_at = NOW()
WHERE activity_id IN (
  'a841a5e7-1d00-4ac0-acb2-b688038addf6',
  'b2bde528-7ebe-4a51-8850-c3c55ab71e30',
  '7ae6cdb6-b103-4e7b-9dbd-7d8f27dc28c6',
  '4233a6a8-0096-40bb-aed4-03048838e00c',
  'c95f49b9-907e-4d82-a7f0-149efeea031f',
  '9c6a37a9-8be5-4072-8351-98b3aae87f8c',
  '455696e6-f450-4cf9-a04e-9b33f4987653',
  '075b7dca-881d-409a-abb8-b9bbceea29cd',
  '6a958406-5d76-43a9-9992-c6b04b4da2a7'
);
