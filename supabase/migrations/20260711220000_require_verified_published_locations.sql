-- Published listings must have a real coordinate so radius and travel filters remain accurate.
with verified_venues (
  old_address,
  verified_address,
  verified_lat,
  verified_long,
  maps_url
) as (
  values
    ('CRATE Walthamstow, E17, London', 'CRATE PLACES UK, 35 St James Street, London E17 7FY', 51.580584::numeric, -0.032369::numeric, 'https://www.google.com/maps/search/?api=1&query=CRATE+PLACES+UK%2C+35+St+James+Street%2C+London+E17+7FY'),
    ('The Hub Cafe, E9, London', 'The Hub Cafe Community Room, Victoria Park, London E9 7DD', 51.537603::numeric, -0.035746::numeric, 'https://www.google.com/maps/search/?api=1&query=The+Hub+Cafe+Community+Room%2C+Victoria+Park%2C+London+E9+7DD'),
    ('N1c community centre, N1C, London', 'N1C Centre, Plimsoll Building, Handyside Street, London N1C 4BQ', 51.537751::numeric, -0.127320::numeric, 'https://www.google.com/maps/search/?api=1&query=N1C+Centre%2C+Handyside+Street%2C+London+N1C+4BQ'),
    ('The Scout Hut, E17, London', '14th Walthamstow Scout Group, 205A Wood Street, London E17 3NU', 51.585380::numeric, -0.001540::numeric, 'https://www.google.com/maps/search/?api=1&query=14th+Walthamstow+Scout+Group%2C+205A+Wood+Street%2C+London+E17+3NU'),
    ('United Kingdom, N1, London', 'Ivy Street Family Centre, 54 Ivy Street, London N1 5JE', 51.533438::numeric, -0.081011::numeric, 'https://www.google.com/maps/search/?api=1&query=Ivy+Street+Family+Centre%2C+54+Ivy+Street%2C+London+N1+5JE'),
    ('DNA Cafe, London', 'DNA Cafe Bar, 101 Kingsland High Street, London E8 2PB', 51.549541::numeric, -0.075411::numeric, 'https://www.google.com/maps/search/?api=1&query=DNA+Cafe+Bar%2C+101+Kingsland+High+Street%2C+London+E8+2PB'),
    ('PAIISE, E10, London', 'Pause Leyton, 478 High Road Leyton, London E10 6QA', 51.565412::numeric, -0.010503::numeric, 'https://www.google.com/maps/search/?api=1&query=Pause+Leyton%2C+478+High+Road+Leyton%2C+London+E10+6QA'),
    ('N1 8AF, N1, London', 'Colebrooke Row, London N1 8AF', 51.535125::numeric, -0.101613::numeric, 'https://www.google.com/maps/search/?api=1&query=Colebrooke+Row%2C+London+N1+8AF'),
    ('Sol Centre Studio, N19, London', 'Sol Centre Yoga and Sauna, 216 Fairbridge Road, London N19 3HT', 51.568343::numeric, -0.123482::numeric, 'https://www.google.com/maps/search/?api=1&query=Sol+Centre+Yoga+and+Sauna%2C+216+Fairbridge+Road%2C+London+N19+3HT'),
    ('Little Sisters of the Poor, N16, London', 'St Anne''s Home, 77 Manor Road, London N16 5BL', 51.566808::numeric, -0.079689::numeric, 'https://www.google.com/maps/search/?api=1&query=St+Anne%27s+Home%2C+77+Manor+Road%2C+London+N16+5BL')
)
update public.activities as activity
set
  address = venue.verified_address,
  lat = venue.verified_lat,
  long = venue.verified_long,
  google_place_id = null,
  google_place_uri = venue.maps_url,
  google_link = venue.maps_url,
  updated_at = now()
from verified_venues as venue
where activity.address = venue.old_address;

-- Correct ambiguous earlier matches that resolved to unrelated London landmarks.
with named_venues (activity_name, verified_address, verified_lat, verified_long, maps_url) as (
  values
    ('BabySalsa & BabyChata Dance Class', 'The Bridge, 73-81 Southwark Bridge Road, London SE1 0NQ', 51.504618::numeric, -0.095423::numeric, 'https://www.google.com/maps/search/?api=1&query=The+Bridge%2C+73-81+Southwark+Bridge+Road%2C+London+SE1+0NQ'),
    ('Mum and Baby Soundbath Sessions', 'The Bridge, 73-81 Southwark Bridge Road, London SE1 0NQ', 51.504618::numeric, -0.095423::numeric, 'https://www.google.com/maps/search/?api=1&query=The+Bridge%2C+73-81+Southwark+Bridge+Road%2C+London+SE1+0NQ'),
    ('BRING YOUR BABY PUB QUIZ | Battersea Clapham Parent Social at The Plough', 'The Plough, 89 St John''s Hill, London SW11 1SY', 51.461590::numeric, -0.173217::numeric, 'https://www.google.com/maps/search/?api=1&query=The+Plough%2C+89+St+John%27s+Hill%2C+London+SW11+1SY'),
    ('BRING YOUR BABY PUB QUIZ | East Dulwich Parent Social at The Plough', 'The Plough, 381 Lordship Lane, London SE22 8JJ', 51.449455::numeric, -0.074269::numeric, 'https://www.google.com/maps/search/?api=1&query=The+Plough%2C+381+Lordship+Lane%2C+London+SE22+8JJ'),
    ('Notting Hill - Bach to Baby Family Concert', 'Bach to Baby - Notting Hill, St Peter''s Church, Kensington Park Road, London W11 2PN', 51.512582::numeric, -0.202796::numeric, 'https://www.google.com/maps/search/?api=1&query=Bach+to+Baby+Notting+Hill%2C+St+Peter%27s+Church%2C+London+W11+2PN'),
    ('Notting Hill - Bach to Baby Half Term Family Concert', 'Bach to Baby - Notting Hill, St Peter''s Church, Kensington Park Road, London W11 2PN', 51.512582::numeric, -0.202796::numeric, 'https://www.google.com/maps/search/?api=1&query=Bach+to+Baby+Notting+Hill%2C+St+Peter%27s+Church%2C+London+W11+2PN'),
    ('South Kensington - Bach to Baby Family Concert', 'Bach to Baby - South Kensington, St Stephen''s Church, Southwell Gardens, London SW7 4RL', 51.495738::numeric, -0.183362::numeric, 'https://www.google.com/maps/search/?api=1&query=Bach+to+Baby+South+Kensington%2C+St+Stephen%27s+Church%2C+London+SW7+4RL'),
    ('South Kensington - Bach to Baby Half Term Family Concert', 'Bach to Baby - South Kensington, St Stephen''s Church, Southwell Gardens, London SW7 4RL', 51.495738::numeric, -0.183362::numeric, 'https://www.google.com/maps/search/?api=1&query=Bach+to+Baby+South+Kensington%2C+St+Stephen%27s+Church%2C+London+SW7+4RL')
)
update public.activities as activity
set
  address = venue.verified_address,
  lat = venue.verified_lat,
  long = venue.verified_long,
  google_place_id = null,
  google_place_uri = venue.maps_url,
  google_link = venue.maps_url,
  updated_at = now()
from named_venues as venue
where activity.activity_name = venue.activity_name
  and activity.source_name = 'Eventbrite London baby listings';

-- The source does not state a session venue for these two listings. Do not show
-- an inaccurate location in a distance-based directory.
update public.activities
set public_listing_status = 'archived', updated_at = now()
where activity_name in (
  'COOK WITH KASPER: FOOD EXPLORERS WALTHAMSTOW',
  'COOK WITH KASPER: KASPER''S SUPPER CLUB!'
)
and lat is null
and long is null;

-- Keep even archived source records mappable for data-quality auditing. The two
-- Cook with Kasper records use the provider's registered address only and stay
-- archived until a session venue is confirmed.
with remaining_locations (activity_name, verified_address, verified_lat, verified_long, maps_url) as (
  values
    ('COOK WITH KASPER: FOOD EXPLORERS WALTHAMSTOW', 'Cook with Kasper registered address, 180 Billet Road, London E17 5DX', 51.599770::numeric, -0.028642::numeric, 'https://www.google.com/maps/search/?api=1&query=180+Billet+Road%2C+London+E17+5DX'),
    ('COOK WITH KASPER: KASPER''S SUPPER CLUB!', 'Cook with Kasper registered address, 180 Billet Road, London E17 5DX', 51.599770::numeric, -0.028642::numeric, 'https://www.google.com/maps/search/?api=1&query=180+Billet+Road%2C+London+E17+5DX'),
    ('Fortified Fathers Book Launch', 'Anerley Road, London SE20 8AJ', 51.412369::numeric, -0.067099::numeric, 'https://www.google.com/maps/search/?api=1&query=SE20+8AJ%2C+London'),
    ('NEW JACK SWING & THE BIG KIDS PARTY - ROOFTOP SUMMER COOK OUT', 'Brixton Storeys, 467-469 Brixton Road, London SW9 8HH', 51.461551::numeric, -0.114952::numeric, 'https://www.google.com/maps/search/?api=1&query=Brixton+Storeys%2C+467-469+Brixton+Road%2C+London+SW9+8HH')
)
update public.activities as activity
set
  address = venue.verified_address,
  lat = venue.verified_lat,
  long = venue.verified_long,
  google_place_id = null,
  google_place_uri = venue.maps_url,
  google_link = venue.maps_url,
  updated_at = now()
from remaining_locations as venue
where activity.activity_name = venue.activity_name
  and (activity.lat is null or activity.long is null);

alter table public.activities
  drop constraint if exists published_activities_require_coordinates;

alter table public.activities
  add constraint published_activities_require_coordinates
  check (
    public_listing_status <> 'published'
    or (lat is not null and long is not null)
  );
