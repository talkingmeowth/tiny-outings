-- Auto-approve GAIL's review proposals using imagery verified on each
-- listing's official branch page. Where no branch photograph exists, use the
-- high-resolution GAIL's bakery default photo, not another branch's facade.
-- Existing human approvals are retained as ground truth.
create temporary table gails_official_choices (
  activity_id uuid primary key,
  image_url text not null,
  page_url text not null,
  image_title text not null,
  width integer not null,
  height integer not null,
  generic_photo boolean not null
) on commit drop;

insert into gails_official_choices values
    ('02810dcb-dea2-4ac3-bb9b-835f52f9e395'::uuid, 'https://gails.com/cdn/shop/files/Queens_Park_2.jpg?v=1688143119', 'https://gails.com/pages/queens-park', 'Queens Park', 3094, 1740, false),
    ('ea80f537-a3d7-4745-a3e4-9859f99ff485'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/abbeville-road', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('411fcf8f-29aa-4f86-972c-27a1255e1cff'::uuid, 'https://gails.com/cdn/shop/files/Archway.jpg?v=1771950826', 'https://gails.com/pages/archway', 'Archway Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('189f3ac9-5c63-42d9-a572-0ea619fe8c6e'::uuid, 'https://gails.com/cdn/shop/files/Askew_Road_2.jpg?v=1688490628', 'https://gails.com/pages/askew-road', 'Askew Road', 3539, 1990, false),
    ('5b33c865-ce82-4deb-8bc9-c3e0a147045e'::uuid, 'https://gails.com/cdn/shop/files/Baker_Street_2.jpg?v=1688395289', 'https://gails.com/pages/baker-street', 'Baker Street', 3093, 1741, false),
    ('e7c00942-45d1-44e6-8c39-c5e328ce9318'::uuid, 'https://gails.com/cdn/shop/files/Balham.jpg?v=1708956541', 'https://gails.com/pages/balham', 'Balham Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('5f6ef100-cc2b-48de-bf84-2830a8580cbc'::uuid, 'https://gails.com/cdn/shop/files/Barnes_2.jpg?v=1688144410', 'https://gails.com/pages/barnes', 'Barnes', 3094, 1740, false),
    ('a4852c83-0353-4d20-8659-d4a440abe193'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/barons-court', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('ac2d4fa3-eb3a-4279-9f25-8e0436e39427'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/bermondsey', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('99deddfe-d8f0-4f4a-ab53-b8e201caf21f'::uuid, 'https://gails.com/cdn/shop/files/Blackfriars_2.jpg?v=1688145385', 'https://gails.com/pages/blackfriars', 'Blackfriars', 3093, 1740, false),
    ('8adc4902-d67c-46ff-a5bd-f33e4a4cc929'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/bloomsbury/', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('9e7d3d3b-aab4-4bd6-8212-d8860f48ad4e'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/brook-green', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('2a2f73a9-df21-4132-a843-04185561a1ce'::uuid, 'https://gails.com/cdn/shop/files/Brunswick-Centre_2.jpg?v=1688404388', 'https://gails.com/pages/brunswick-centre', 'Brunswick Centre', 2652, 1491, false),
    ('5f7f2099-193e-4063-90fa-8dc0e9ff2dd1'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/buckingham-palace-road', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('d8fd0de0-d097-46dd-a6b9-ed09967884c1'::uuid, 'https://gails.com/cdn/shop/files/Camden.jpg?v=1709032349', 'https://gails.com/pages/camden', 'Camden Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('94ae913b-8b34-4bb0-b8ae-5304e97aa3b4'::uuid, 'https://gails.com/cdn/shop/files/Crossrail_Place.jpg?v=1783688629', 'https://gails.com/pages/crossrail-place', 'Crossrail Place | GAIL''s Bakery', 3000, 1687, false),
    ('112e3de3-2e00-48bf-a297-dd9a113e51d8'::uuid, 'https://gails.com/cdn/shop/files/Canary_Wharf.jpg?v=1718632900', 'https://gails.com/pages/canary-wharf-waitrose', 'Canary Wharf | GAIL''s Bakery', 3000, 1687, false),
    ('9a1490fb-8fb0-43c9-9d5f-8225872e12ee'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/chelsea', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('dc1ca2a6-102d-4d13-a852-0e3d0ee01f48'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/chiswick', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('8b41a62d-6d84-4843-b8d4-8bf06cc8e2f8'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/clapham-old-town', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('40fa1078-4e2d-4ec4-8888-f2a48b02ef4b'::uuid, 'https://gails.com/cdn/shop/files/Clifton-Road_2.jpg?v=1688490183', 'https://gails.com/pages/clifton-road', 'Clifton Road', 2652, 1491, false),
    ('20032036-c951-494c-97be-8c7f95834f0f'::uuid, 'https://gails.com/cdn/shop/files/Cowcross-Street_2.jpg?v=1688490944', 'https://gails.com/pages/cowcross-street', 'Cowcross Street', 2658, 1495, false),
    ('b64cea87-f310-4285-bd36-9f652c79ca23'::uuid, 'https://gails.com/cdn/shop/files/Cromwell_Place.jpg?v=1764588324', 'https://gails.com/pages/cromwell-place', 'Cromwell Place Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('84623cf2-020b-4fb5-bf39-d0df4783e52a'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/crouch-end', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('f1a4b0cc-0353-4598-8d06-3743d6e25fa3'::uuid, 'https://gails.com/cdn/shop/files/crystal_palace_bakery_image.jpg?v=1765791833', 'https://gails.com/pages/crystal-palace', 'Crystal Palace Bakery | GAIL''s Bakery', 2220, 1237, false),
    ('0b299d65-b7b9-42cb-bb72-c14aa8c118b3'::uuid, 'https://gails.com/cdn/shop/files/Dulwich_Village.jpg?v=1708611722', 'https://gails.com/pages/dulwich-village', 'Dulwich Village Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('3e238f3f-0c54-4d81-bd0b-61b951c504bd'::uuid, 'https://gails.com/cdn/shop/files/East_Dulwich_2.jpg?v=1688404742', 'https://gails.com/pages/east-dulwich', 'East Dulwich', 3094, 1740, false),
    ('1269deaa-6b68-457b-8465-404bcf6468af'::uuid, 'https://gails.com/cdn/shop/files/Elephant_Park.jpg?v=1724751137', 'https://gails.com/pages/elephant-park', 'Elephant Park Bakery  | GAIL''s Bakery', 3000, 1687, false),
    ('c185c288-3114-4de3-8b12-176e6ca50fbf'::uuid, 'https://gails.com/cdn/shop/files/Exmouth_2.jpg?v=1688396060', 'https://gails.com/pages/exmouth-market', 'Exmouth Market', 3094, 1740, false),
    ('d2ab3050-b3ac-4e41-93e9-27cf933617bf'::uuid, 'https://gails.com/cdn/shop/files/Finsbury_Park_2.jpg?v=1688392955', 'https://gails.com/pages/finsbury-park', 'Finsbury Park', 3094, 1740, false),
    ('a4c0e942-ded0-4ba9-ae39-ab2fc9ba0615'::uuid, 'https://gails.com/cdn/shop/files/Fulham.jpg?v=1708614050', 'https://gails.com/pages/fulham-broadway', 'Fulham Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('fb451f94-3071-4a95-95d7-bb62ccd8ee57'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/golders-green', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('a1cba74d-0011-495f-b513-973e2f092255'::uuid, 'https://gails.com/cdn/shop/files/Great_Portland_Street.jpg?v=1708610853', 'https://gails.com/pages/great-portland-street', 'Great Portland Street Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('51427047-3d52-4d7f-9c30-9c55b84835ac'::uuid, 'https://gails.com/cdn/shop/files/Great_Russell_Street.jpg?v=1753694611', 'https://gails.com/pages/great-russell-street', 'Great Russell Street Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('ba56132b-e009-4603-88db-2ea36ce53394'::uuid, 'https://gails.com/cdn/shop/files/Greenwich_2.jpg?v=1688393341', 'https://gails.com/pages/greenwich', 'Greenwich', 3093, 1740, false),
    ('2fff4b2a-2769-43d4-9734-d00a89ecd21b'::uuid, 'https://gails.com/cdn/shop/files/Hackney_Castle.jpg?v=1750236403', 'https://gails.com/pages/hackney-castle', 'Hackney Castle Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('f3d3a92c-cb1f-4d65-8c95-9a6ca77f7d5e'::uuid, 'https://gails.com/cdn/shop/files/Herne_Hill.jpg?v=1708613128', 'https://gails.com/pages/herne-hill', 'Herne Hill Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('7a557cc5-e720-4657-b5ed-69a551d11bd4'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/high-street-kensington', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('c9e108e4-8ab6-492d-bfda-34137d7ebba2'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/highgate', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('e1927426-d55b-4baa-9c59-4abb6d5cabc3'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/holborn', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('03486358-d08f-43df-a622-39dec18d20d6'::uuid, 'https://gails.com/cdn/shop/files/Kennington_2.jpg?v=1688404597', 'https://gails.com/pages/kennington', 'Kennington', 2652, 1491, false),
    ('fc83432d-cae0-41e3-b8c7-9f2658a2f28b'::uuid, 'https://gails.com/cdn/shop/files/Kensal_Rise_2_ee017087-a62e-4653-b16f-858b95da8200.jpg?v=1688141638', 'https://gails.com/pages/kensal-rise', 'Kensal Rise', 3597, 2023, false),
    ('dcd41d48-2b70-4f33-aae8-78be84ab8aec'::uuid, 'https://gails.com/cdn/shop/files/Kensington-Arcade_2.jpg?v=1688404057', 'https://gails.com/pages/kensington-arcade', 'Kensington Arcade', 2652, 1491, false),
    ('397e131e-ac51-4d2b-a513-30878112d07a'::uuid, 'https://gails.com/cdn/shop/files/Kentish_Town.jpg?v=1710326642', 'https://gails.com/pages/kentish-town', 'Kentish Town Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('667c5584-e511-42dd-a2c4-5f6634836aab'::uuid, 'https://gails.com/cdn/shop/files/Kings_Cross_2.jpg?v=1688393785', 'https://gails.com/pages/kings-cross', 'Kings Cross', 2652, 1491, false),
    ('bec82ed7-8227-4b3f-bd1d-db9155954d40'::uuid, 'https://gails.com/cdn/shop/files/Liverpool_Street.jpg?v=1739524143', 'https://gails.com/pages/liverpool-street-station', 'Liverpool Street Station | GAIL''s Bakery', 3000, 1687, false),
    ('9098ad91-3936-4b9c-bddd-c0514c6fb968'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/bloomsbury/', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('e071ab10-2421-405a-9698-6be624aec380'::uuid, 'https://gails.com/cdn/shop/files/Long_Acre.jpg?v=1740131154', 'https://gails.com/pages/long-acre', 'Long Acre | GAIL''s Bakery', 3000, 1687, false),
    ('5eccd1d5-b3fc-4994-9411-b3a046e7a05b'::uuid, 'https://gails.com/cdn/shop/files/Maida_Vale.jpg?v=1710327130', 'https://gails.com/pages/maida-vale', 'Maida Vale Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('55d10f3c-1971-4db2-af6c-6df98e4c857f'::uuid, 'https://gails.com/cdn/shop/files/gails_melcombe_street_bakery_page.jpg?v=1720775193', 'https://gails.com/pages/melcombe-street', 'Melcombe Bakery | GAIL''s Bakery', 2200, 1237, false),
    ('7d074c4b-b011-4219-9ab5-6432a193a7dc'::uuid, 'https://gails.com/cdn/shop/files/Millenium_Bridge.jpg?v=1744360269', 'https://gails.com/pages/millennium-bridge', 'Millennium Bridge Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('50d1a89e-775f-440e-a613-23094b850e5b'::uuid, 'https://gails.com/cdn/shop/files/Muswell_Hill.jpg?v=1708958665', 'https://gails.com/pages/muswell-hill', 'Muswell Hill | GAIL''s Bakery', 3000, 1687, false),
    ('f2efc09b-a59b-4eb9-aa03-56b66f13792d'::uuid, 'https://gails.com/cdn/shop/files/Neo_Bankside.jpg?v=1710327342', 'https://gails.com/pages/neo-bankside', 'Neo Bankside Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('6cb6db1d-acba-42c1-8da2-3c64cd532b5f'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/notting-hill', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('4b1dfdc7-0ace-4103-b069-5fab9ecec084'::uuid, 'https://gails.com/cdn/shop/files/Old_Street.jpg?v=1763112791', 'https://gails.com/pages/old-street', 'Old Street Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('79e68a44-df53-4851-822e-4f7b7428d6e0'::uuid, 'https://gails.com/cdn/shop/files/Paddington_2.jpg?v=1688393576', 'https://gails.com/pages/paddington', 'Paddington', 2209, 1243, false),
    ('cb96018b-4a70-44ea-823b-7e3de6308144'::uuid, 'https://gails.com/cdn/shop/files/Palmers_Green.jpg?v=1747988795', 'https://gails.com/pages/palmers-green', 'Palmers Green Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('bcfda34c-78a3-4869-8fb3-bf68a664671f'::uuid, 'https://gails.com/cdn/shop/files/Pentonville_Road.jpg?v=1762510506', 'https://gails.com/pages/pentonville-road', 'Pentonville Road Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('8d3a9751-0bf9-403a-8667-5099ad19d6b0'::uuid, 'https://gails.com/cdn/shop/files/Primrose_Hill.jpg?v=1738314571', 'https://gails.com/pages/primrose-hill', 'Primrose Hill | GAIL''s Bakery', 3000, 1687, false),
    ('abb73493-2aae-42bc-8f5c-f20a10be6f9b'::uuid, 'https://gails.com/cdn/shop/files/shaftesbury_bakery.jpg?v=1730107077', 'https://gails.com/pages/shaftesbury-avenue', 'Shaftesbury Avenue | GAIL''s Bakery', 3000, 1687, false),
    ('63a2881d-8285-4a36-88a5-3fe87e658943'::uuid, 'https://gails.com/cdn/shop/files/Shoreditch.jpg?v=1782721940', 'https://gails.com/pages/shoreditch', 'Shoreditch Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('959e5611-6947-42e4-a059-b09a6ca63ff8'::uuid, 'https://gails.com/cdn/shop/files/Soho_2.jpg?v=1688492488', 'https://gails.com/pages/soho', 'Soho', 2567, 1445, false),
    ('99d0f4e0-516c-4372-a823-a4a76dedf368'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/south-lambeth', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('b028a9a3-3fd0-498d-8269-3acc9144e324'::uuid, 'https://gails.com/cdn/shop/files/South_Woodford_2.jpg?v=1688402716', 'https://gails.com/pages/south-woodford', 'South Woodford', 1798, 1011, false),
    ('fb1a2680-2b21-4ffb-bb35-de3611c15581'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/southbank', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('14ceefcc-fa85-4d55-9bd0-679f61a258a0'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/spitalfields', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('1fe0f9b5-00e5-49c8-b5a1-decbd6509a0a'::uuid, 'https://gails.com/cdn/shop/files/stoke_newington.jpg?v=1740990734', 'https://gails.com/pages/stoke-newington', 'Stoke Newington | GAIL''s Bakery', 1920, 1080, false),
    ('ee56c9cc-d043-4745-b28e-1f3a231a1324'::uuid, 'https://gails.com/cdn/shop/files/Strand.jpg?v=1708613840', 'https://gails.com/pages/strand', 'Strand Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('76c64408-f08a-4a6b-aeb6-3ec8abd4537a'::uuid, 'https://gails.com/cdn/shop/files/streatham_hill_bakery.jpg?v=1759760663', 'https://gails.com/pages/streatham-hill', 'Streatham Hill Bakery | GAIL''s Bakery', 2200, 1237, false),
    ('164ff3b7-0b8e-46d8-ae98-7bc076a9deb6'::uuid, 'https://gails.com/cdn/shop/files/Swains_Lane_2.jpg?v=1688393902', 'https://gails.com/pages/swains-lane', 'Swains Lane', 3094, 1740, false),
    ('b10505ef-dde6-4a8b-a48f-f87439f075e6'::uuid, 'https://gails.com/cdn/shop/files/The_Cut_2.jpg?v=1688145600', 'https://gails.com/pages/the-cut', 'The Cut', 3094, 1740, false),
    ('4cc86a41-cee8-49f8-bd6c-effd2d0284ba'::uuid, 'https://gails.com/cdn/shop/files/Tooting_Broadway.jpg?v=1769765713', 'https://gails.com/pages/tooting-broadway', 'Tooting Broadway Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('0acf9894-efa2-4ec9-83a3-ccf5f7d9f5aa'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/victoria-park', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('51108070-8204-4a42-8d8a-0148a69114d5'::uuid, 'https://gails.com/cdn/shop/files/Walthamstow.jpg?v=1728036788', 'https://gails.com/pages/walthamstow-village', 'Walthamstow Village | GAIL''s Bakery', 3000, 1687, false),
    ('42eaa536-28f1-418d-9c20-89e13feff259'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/wanstead', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('ac24b942-be3b-4fe4-8ccf-0c7bfae0b72a'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/west-hampstead', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('e46a9f58-a0eb-43ce-8602-55f33948954d'::uuid, 'https://gails.com/cdn/shop/files/Bakery_Page_Default_Photo.jpg?v=1710323054', 'https://gails.com/pages/westbourne-grove', 'GAIL''s Bakeries | GAIL''s Bakery', 3000, 1687, true),
    ('15ea1491-1689-4ea4-a867-25e6627d8a66'::uuid, 'https://gails.com/cdn/shop/files/Cheapside.jpg?v=1780324065', 'https://gails.com/pages/cheapside', 'Cheapside Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('ae6501c3-2a69-4102-90ff-cecfc0cf8360'::uuid, 'https://gails.com/cdn/shop/files/Crossrail_Place.jpg?v=1783688629', 'https://gails.com/pages/crossrail-place', 'Crossrail Place | GAIL''s Bakery', 3000, 1687, false),
    ('5920689a-19a2-4f7e-ade5-57c631eee296'::uuid, 'https://gails.com/cdn/shop/files/Holland_Park.jpg?v=1780324300', 'https://gails.com/pages/holland-park', 'Holland Park Bakery | GAIL''s Bakery', 3000, 1687, false),
    ('857cb8d8-d5f5-4af3-855c-e56d7a528926'::uuid, 'https://gails.com/cdn/shop/files/Westfield_Stratford.jpg?v=1775730617', 'https://gails.com/pages/westfield-stratford', 'Westfield Stratford Bakery | GAIL''s Bakery', 3000, 1687, false);

do $$
declare
  item record;
  proposal public.activity_image_model_proposals;
  candidate jsonb;
begin
  for item in
    select choice.*, activity.activity_name
    from gails_official_choices choice
    join public.activities activity on activity.activity_id = choice.activity_id
    where activity.archive = false
      and activity.public_listing_status in ('draft', 'published')
      and activity.activity_name ~* '^GAIL.?S( |$)'
    order by activity.activity_id
  loop
    select * into proposal
    from public.activity_image_model_proposals
    where activity_id = item.activity_id
    for update;
    if not found or proposal.decision not in ('pending', 'unsure') then
      continue;
    end if;
    candidate := jsonb_build_object(
      'image_url', item.image_url,
      'source_page_url', item.page_url,
      'title', item.image_title,
      'width', item.width,
      'height', item.height,
      'source_domain', 'gails.com',
      'source_field', 'official_gails_branch_page',
      'source_kind', 'organiser',
      'auto_approval_method', 'verified_official_gails_page',
      'brand_generic_photo', item.generic_photo
    );
    update public.activity_image_model_proposals
    set alternatives = coalesce(alternatives, '[]'::jsonb) || jsonb_build_array(candidate)
    where batch_id = proposal.batch_id and activity_id = proposal.activity_id;
    perform public.approve_model_image_across_sessions(
      proposal.batch_id, proposal.activity_id, proposal.proposal_hash,
      candidate, null);
  end loop;
end;
$$;
