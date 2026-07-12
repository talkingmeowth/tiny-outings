-- Keep Fever focused on activities that suit babies, young children and their families.
UPDATE public.activities
SET public_listing_status = 'archived', updated_at = now()
WHERE data_source = 'fever'
  AND activity_name IN (
    'Les Misérables',
    'Modern Magic Show with Jake Banfield',
    'Paradox Museum London - The Ultimate Birthday Party Venue in London'
  );

WITH curated (activity_name, description) AS (
  VALUES
    ('Babylon Park: London’s Underground Theme Park', 'Indoor Camden theme park with rides, arcade games and soft-play zones for little explorers.'),
    ('Christmas by candlelight at 235 Shaftesbury Avenue', 'Seasonal candlelit concert at Bloomsbury Central, with child concession tickets available.'),
    ('Halloween at Kew', 'After-dark Halloween trail at Kew Gardens with illuminated scenes, performers and seasonal treats.'),
    ('Harry Potter Warner Bros. Studios with Coach Transport from London', 'Coach day trip from central London to the Warner Bros. Studio Tour and its Harry Potter film sets.'),
    ('Hobbledown Heath: London''s Largest Adventure Playground', 'Adventure playground and animal park with climbing, outdoor play and family-friendly activities.'),
    ('House of Dreamers', 'Family-friendly immersive exhibition with dreamy installations, a giant ball pit and interactive moments.'),
    ('Kid Quest in Kensington Gardens, London: Superhero City Adventure for Kids (Ages 4–8)', 'Self-guided superhero adventure around Kensington Gardens for children aged 4 to 8.'),
    ('Matilda The Musical', 'West End musical based on Roald Dahl''s Matilda, best suited to older children.'),
    ('Mini Genius Lab: Cool Science Experiments for Kids', 'Hands-on science workshop where children can try colourful experiments and learn through play.'),
    ('Paradox Museum London', 'Interactive illusion museum with playful rooms, visual puzzles and family photo opportunities.'),
    ('PAW Patrol Afternoon Tea Bus Tour', 'PAW Patrol-themed afternoon tea and sightseeing bus ride around central London.'),
    ('PAW Patrol Christmas Lights Bus Tour', 'Seasonal PAW Patrol bus tour with London lights, treats and family entertainment.'),
    ('Peppa Pig Afternoon Tea London Sightseeing Bus Tour', 'Peppa Pig-themed afternoon tea and sightseeing bus ride for young children and their grown-ups.'),
    ('Peppa Pig Christmas Bus Tour', 'Seasonal Peppa Pig sightseeing bus tour with festive treats and entertainment.'),
    ('Peppa Pig Halloween London Sightseeing Bus Tour', 'Seasonal Peppa Pig bus tour with Halloween treats, games and sightseeing.'),
    ('Raver Tots Wembley', 'Family dance party with child-friendly music, performers, face painting and space to move.'),
    ('The Lion King', 'Family West End musical at the Lyceum Theatre, recommended for children aged three and over.'),
    ('The Museum of Brands: A Visual Journey Through Consumer Culture', 'Small Notting Hill museum with nostalgic toys, packaging and family tickets.'),
    ('Tootbus London Discovery Bus Tour', 'Hop-on hop-off London bus tour with a children''s audio guide and stroller-friendly access.'),
    ('ZSL London Zoo', 'Family day out at London Zoo with animals, keeper talks and feeding sessions.')
)
UPDATE public.activities AS activity
SET description = curated.description, updated_at = now()
FROM curated
WHERE activity.data_source = 'fever'
  AND activity.activity_name = curated.activity_name;
