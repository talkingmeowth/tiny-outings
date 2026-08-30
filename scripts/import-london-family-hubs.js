/* global process */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ageForFamilyHubSession,
  categoryForFamilyHubSession,
  cleanText,
  isFamilyActivitySession,
  normalisePostcode,
  parseTimeRanges,
  validateFamilyHubSession,
  weekdayFromHeading,
} from './lib/family-hub-timetable-policy.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputSql = join(root, 'supabase', 'seed', 'activities_london_family_hub_timetables.generated.sql');
const outputAudit = join(root, 'data', 'london_family_hub_timetables_import.generated.json');
const sourceName = 'London family hub official timetables';
const legacySourceName = 'GOV.UK Family Hubs and Start for Life';
const userAgent = 'Mozilla/5.0 (compatible; TinyOutings/1.0; +https://tiny-outings-cpjh.onrender.com)';

const camdenSource = 'https://families.camden.gov.uk/full-stay-play-timetable/';
const barkingSource = 'https://www.lbbd.gov.uk/events/stay-and-play-0-5-years-old-valence-library';
const lambethSources = {
  stockwell: 'https://www.lambeth.gov.uk/sites/default/files/2026-08/Brixton%20Stockwell%20Children%27s%20Centre%20Autumn%2026.pdf',
  jubilee: 'https://www.lambeth.gov.uk/sites/default/files/2026-08/Brixton_Tulse_Hill_Better_Start%20-Autumn_26.pdf',
  maytree: 'https://www.lambeth.gov.uk/sites/default/files/2026-08/Clapham_Brixton_Hill_Childrens_Centre-Autumn-26.pdf',
  henryFawcett: 'https://www.lambeth.gov.uk/sites/default/files/2026-08/North%20Lambeth%20Better%20Start%20Autumn%2026.pdf',
  bentonsLane: 'https://www.lambeth.gov.uk/sites/default/files/2026-08/Norwood_Better_Start_Autumn_26.pdf',
};
const mertonSources = {
  acacia: 'https://www.merton.gov.uk/sites/default/files/2026-08/Acacia%20September%20Timetable%20-%20September%2026.pdf',
  churchRoad: 'https://www.merton.gov.uk/sites/default/files/2026-08/Church%20Road%20September%20Timetable%20-%20September%2026.pdf',
};

const hounslowPages = [
  { postcode: 'TW8 0BJ', label: 'Best Start Family Hub East', url: 'https://fsd.hounslow.gov.uk/SynergyWeb/Family_Hubs/FamilyHubEast.aspx' },
  { postcode: 'TW3 4JG', label: 'Best Start Family Hub Central', url: 'https://fsd.hounslow.gov.uk/SynergyWeb/Family_Hubs/Family_Hub_Central.aspx' },
  { postcode: 'TW13 5AF', label: 'Best Start Family Hub West', url: 'https://fsd.hounslow.gov.uk/SynergyWeb/Family_Hubs/FamilyHubWest.aspx' },
];

const hammersmithPages = [
  {
    postcode: 'W12 0AP',
    label: 'Family Hub Old Oak Community Centre',
    url: 'https://www.lbhf.gov.uk/children-and-young-people/family-hub/find-family-hub-or-childrens-centre/family-hub-old-oak-community-centre',
  },
  {
    postcode: 'SW6 5PG',
    label: 'Family Hub Tudor Rose Community Centre',
    url: 'https://www.lbhf.gov.uk/children-and-young-people/family-hub/find-family-hub-or-childrens-centre/family-hub-tudor-rose-community-centre',
  },
  {
    postcode: 'SW6 6JR',
    label: 'Family Hub Stephen Wiltshire Centre',
    url: 'https://www.lbhf.gov.uk/children-and-young-people/family-hub/find-family-hub-or-childrens-centre/family-hub-stephen-wiltshire-centre',
  },
];

const currentSourceGaps = [
  {
    borough: 'Brent',
    legacy_postcodes: ['HA04PW', 'NW98JD', 'NW109SD', 'HA98RJ', 'NW103HL', 'HA99YP'],
    source: 'https://www.brent.gov.uk/familywellbeingcentres',
    reason: 'The official hub page did not yet publish an Autumn 2026 activity timetable; the latest indexed centre schedules had ended.',
  },
  {
    borough: 'Croydon',
    legacy_postcodes: ['SE256XX', 'CR28HD'],
    source: 'https://www.croydon.gov.uk/children-young-people-and-families/family-hubs',
    reason: 'The published transition timetable ends on 4 September 2026 and does not reliably map every session to the two legacy centre records.',
  },
  {
    borough: 'Greenwich',
    legacy_postcodes: ['SE186BD', 'SE137QZ', 'SE39QX', 'SE288EZ'],
    source: 'https://www.better.org.uk/children-centre/london/greenwich',
    reason: 'Official centre pages list activity types but do not publish the required day and start/end times.',
  },
  {
    borough: 'Hackney',
    legacy_postcodes: ['E83RP', 'E50EG', 'N167SH', 'N42NP'],
    source: 'https://education.hackney.gov.uk/content/hackney-children-and-family-hubs',
    reason: 'The official April-to-July timetable has ended and the hub calendars do not yet contain the new term activities.',
  },
  {
    borough: 'Hammersmith and Fulham',
    legacy_postcodes: ['W120AP', 'SW66JR', 'SW65PG'],
    source: 'https://www.lbhf.gov.uk/children-and-young-people/family-hub',
    reason: 'The three official centre timetable URLs currently return replacement or not-found pages during the council website migration.',
  },
  {
    borough: 'Haringey',
    legacy_postcodes: ['N103QJ', 'N156NU'],
    source: 'https://haringey.gov.uk/children-young-people-families/best-start-family-hubs/healthy-babies',
    reason: 'The current official venue feeds contain no upcoming bookable child activity at these two legacy centres.',
  },
  {
    borough: 'Islington',
    legacy_postcodes: ['N12SX', 'N77EN', 'N10DX'],
    source: 'https://www.islington.gov.uk/children-and-families/bright-start-islington-start-for-life-and-family-hubs',
    reason: 'The production timetable download could not be independently machine-verified; a separately indexed test table was not accepted as live data.',
  },
  {
    borough: 'Lewisham',
    legacy_postcodes: ['SE63HB', 'SE85NH', 'SE83PZ', 'SE64JF', 'SE41JJ'],
    source: 'https://lewishamfamilyhubs.org.uk/p/whats-on/activities-and-timetables',
    reason: 'The official page says Autumn activities start on 1 September but asks users to check back for the new timetables.',
  },
  {
    borough: 'Newham',
    legacy_postcodes: ['E62RT', 'E125PB', 'E153JT'],
    source: 'https://www.newham.gov.uk/homepage/285/supporting-children-and-young-people',
    reason: 'The latest official detailed hub timetable found covered April to June 2026 and is no longer current.',
  },
  {
    borough: 'Southwark',
    legacy_postcodes: ['SE50RN', 'SE156DT', 'SE218QS', 'SE153PD', 'SE163PN'],
    source: 'https://localoffer.southwark.gov.uk/',
    reason: 'No current borough-wide timetable with named child activities, venue, day and start/end time was published for all five legacy centres.',
  },
  {
    borough: 'Tower Hamlets',
    legacy_postcodes: ['E148AP', 'E146AW', 'E15QT', 'E143BX', 'E12EN', 'E33LL', 'E20SN', 'E34GY', 'E29DL', 'E10AF', 'E35DS', 'E32RU', 'E12JP'],
    source: 'https://www.thfamilyhubs.co.uk/',
    reason: 'The official site still advertises the Summer Term 2026 timetable and has not published a current Autumn timetable.',
  },
];

function staticSession({
  postcode,
  venuePostcode = postcode,
  venueAddress = null,
  name,
  day,
  start,
  end,
  age,
  source,
  description,
  booking = false,
  startDate = null,
  endDate = null,
  dates = [],
  notes = null,
  category = null,
}) {
  return {
    hub_postcode: normalisePostcode(postcode),
    venue_postcode: normalisePostcode(venuePostcode),
    venue_address: cleanText(venueAddress),
    activity_name: cleanText(name),
    day,
    start_time: start,
    end_time: end,
    age_suitability: age || ageForFamilyHubSession(name, description),
    category: category || categoryForFamilyHubSession(name, description),
    description: cleanText(description || `${name} at the family hub.`),
    booking_required: Boolean(booking),
    source_page_url: source,
    availability_start_date: startDate,
    availability_end_date: endDate,
    available_dates: dates,
    schedule_notes: notes || 'Official family hub timetable. Check the source page for cancellations or booking changes.',
  };
}

function sessionsForBarking() {
  const shared = {
    name: 'Stay and Play',
    age: 'Parents and children aged 0 to 5 years',
    source: barkingSource,
    description: 'A free family stay-and-play session for children aged 0 to 5. No booking is required.',
    notes: 'Weekly session published by Barking and Dagenham Council; no booking required.',
  };
  return [
    staticSession({ ...shared, postcode: 'IG11 7NB', day: 'Thursday', start: '09:30', end: '10:25' }),
    staticSession({ ...shared, postcode: 'IG11 7NB', day: 'Thursday', start: '10:40', end: '11:35' }),
    staticSession({ ...shared, postcode: 'RM10 9QS', day: 'Tuesday', start: '10:00', end: '11:30' }),
    staticSession({ ...shared, postcode: 'RM6 5NJ', day: 'Thursday', start: '10:00', end: '11:30' }),
  ];
}

function sessionsForCamden() {
  const rows = [
    ['Baby Feeding Session', 'NW1 8DQ', 'Monday', '10:00', '12:00', 'Parents and babies'],
    ['Baby Bonding', 'NW6 2JL', 'Monday', '13:30', '15:30', 'Babies aged 0 to 6 months'],
    ['Baby Play', 'NW1 8DQ', 'Monday', '09:30', '11:00', 'Babies under 1'],
    ['Baby Play', 'NW1 9SU', 'Monday', '13:30', '15:00', 'Babies under 1'],
    ['Baby Play', 'NW1 3TJ', 'Monday', '13:30', '15:00', 'Babies under 1'],
    ['Toddler Time', 'NW1 3TJ', 'Monday', '09:30', '11:30', 'Children under 2'],
    ['Toddler Time', 'NW1 8DQ', 'Monday', '13:30', '15:30', 'Children under 2'],
    ['Fun For All', 'NW1 9SU', 'Monday', '09:30', '11:30', 'Children under 5'],
    ['Fun For All', 'EC1R 4SR', 'Monday', '09:30', '11:30', 'Children under 5'],
    ['Fun For All', 'NW6 2JL', 'Monday', '09:30', '11:30', 'Children under 5'],
    ['Fun For All', 'NW1 1HQ', 'Monday', '10:00', '12:00', 'Children under 5'],
    ['Step In and Play', 'NW6 2JL', 'Monday', '13:30', '14:30', 'Children aged 1 to 5 with developmental differences or SEND'],
    ['Baby Feeding Session', 'NW6 2JL', 'Tuesday', '10:00', '12:00', 'Parents and babies'],
    ['Baby Play', 'NW1 9SU', 'Tuesday', '09:30', '11:00', 'Babies under 1'],
    ['Baby Play', 'NW6 2JL', 'Tuesday', '13:30', '15:00', 'Babies under 1'],
    ['Toddler Time', 'NW1 1HQ', 'Tuesday', '10:00', '12:00', 'Children under 2'],
    ['Fun For All', 'NW1 3TJ', 'Tuesday', '09:30', '11:30', 'Children under 5'],
    ['Fun For All', 'EC1R 4SR', 'Tuesday', '13:30', '15:30', 'Children under 5'],
    ['Fun For All', 'NW1 8DQ', 'Tuesday', '13:30', '15:30', 'Children under 5'],
    ['Superstars SEND stay and play', 'NW1 8DQ', 'Tuesday', '10:00', '12:00', 'Children with developmental differences or SEND'],
    ['Baby Feeding Session', 'EC1R 4SR', 'Wednesday', '13:00', '15:00', 'Parents and babies'],
    ['Baby Play', 'EC1R 4SR', 'Wednesday', '09:30', '11:00', 'Babies under 1'],
    ['Toddler Time', 'NW1 3TJ', 'Wednesday', '09:30', '11:30', 'Children under 2'],
    ['Toddler Time', 'NW6 2JL', 'Wednesday', '09:30', '11:30', 'Children under 2'],
    ['Fun For All', 'NW1 9SU', 'Wednesday', '09:30', '11:30', 'Children under 5'],
    ['Fun For All', 'NW1 8DQ', 'Wednesday', '09:30', '11:30', 'Children under 5'],
    ['Fun For All', 'NW1 1HQ', 'Wednesday', '10:00', '12:00', 'Children under 5'],
    ['KIDS Early Years SEND stay and play', 'NW1 3TJ', 'Wednesday', '13:00', '15:00', 'Children with developmental differences or SEND'],
    ['Baby Feeding Session', 'NW1 1HQ', 'Thursday', '13:00', '15:00', 'Parents and babies'],
    ['Baby Bonding', 'NW1 8DQ', 'Thursday', '10:00', '12:00', 'Babies aged 0 to 6 months'],
    ['Baby Play', 'NW6 2JL', 'Thursday', '09:30', '11:00', 'Babies under 1'],
    ['Baby Play', 'NW1 1HQ', 'Thursday', '10:00', '12:00', 'Babies under 1'],
    ['Toddler Time', 'NW1 9SU', 'Thursday', '09:30', '11:30', 'Children under 2'],
    ['Toddler Time', 'EC1R 4SR', 'Thursday', '09:30', '11:30', 'Children under 2'],
    ['Toddler Time', 'NW1 8DQ', 'Thursday', '09:30', '11:30', 'Children under 2'],
    ['Fun For All', 'NW1 3TJ', 'Thursday', '09:30', '11:30', 'Children under 5'],
    ['Fun For All', 'NW1 9SU', 'Thursday', '13:30', '15:30', 'Children under 5'],
    ['Fun For All', 'NW6 2JL', 'Thursday', '13:30', '15:30', 'Children under 5'],
    ['Nurture and Nourish', 'NW1 3TJ', 'Thursday', '13:30', '15:00', 'Parents, babies and young children'],
    ['Baby Feeding Session', 'NW1 9SU', 'Friday', '10:00', '12:00', 'Parents and babies'],
    ['Baby Bonding', 'NW1 1HQ', 'Friday', '10:00', '12:00', 'Babies aged 0 to 6 months'],
    ['Baby Play', 'NW1 3TJ', 'Friday', '09:30', '11:00', 'Babies under 1'],
    ['Baby Play', 'NW1 8DQ', 'Friday', '13:30', '15:00', 'Babies under 1'],
    ['Fun For All', 'NW1 8DQ', 'Friday', '09:30', '11:30', 'Children under 5'],
    ['Fun For All', 'NW6 2JL', 'Friday', '09:30', '11:30', 'Children under 5'],
    ['Fun For All', 'NW1 1HQ', 'Friday', '10:00', '12:00', 'Children under 5'],
    ['Fun For All', 'EC1R 4SR', 'Friday', '13:30', '15:30', 'Children under 5'],
    ['Fun For All', 'NW1 8DQ', 'Saturday', '09:30', '12:00', 'Children under 5; siblings up to age 8 are welcome'],
  ];
  return rows.map(([name, postcode, day, start, end, age]) => staticSession({
    postcode,
    name,
    day,
    start,
    end,
    age,
    source: camdenSource,
    description: `${name}, from Camden's current full Stay and Play timetable.`,
    notes: 'Current weekly Camden Stay and Play timetable. Check the source for term-time notes and date-specific exceptions.',
  }));
}

function sessionsForLambeth() {
  const term = { startDate: '2026-09-01', endDate: '2026-12-18', booking: true };
  const stockwell = {
    postcode: 'SW9 9TG',
    venuePostcode: 'SW9 9QJ',
    venueAddress: '35 Burgoyne Road, London SW9 9QJ',
  };
  return [
    staticSession({ ...term, ...stockwell, name: 'Toddler Messy Play', day: 'Monday', start: '10:00', end: '11:15', age: 'Children aged 1 to 3 years', source: lambethSources.stockwell }),
    staticSession({ ...term, ...stockwell, name: 'Baby Time', day: 'Monday', start: '13:30', end: '14:30', age: 'Babies aged 0 to 12 months', source: lambethSources.stockwell }),
    staticSession({ ...term, ...stockwell, name: 'Chattertime', day: 'Tuesday', start: '10:00', end: '11:30', age: 'Parents and children under 5', source: lambethSources.stockwell, notes: 'Term-time weekly speech, language and play session. Booking required.' }),
    staticSession({ ...term, ...stockwell, name: 'Play and Song', day: 'Tuesday', start: '13:30', end: '14:30', age: 'Children aged 18 to 36 months', source: lambethSources.stockwell }),
    staticSession({ ...term, ...stockwell, name: 'Fussy Eating Workshop', day: 'Wednesday', start: '09:45', end: '11:45', age: 'Parents and carers of young children', source: lambethSources.stockwell, dates: ['2026-10-21', '2026-12-02'] }),
    staticSession({ ...term, ...stockwell, name: 'Stay and Play', day: 'Wednesday', start: '13:30', end: '15:00', age: 'Children aged 0 to 4 years', source: lambethSources.stockwell }),
    staticSession({ ...term, ...stockwell, name: 'Play and Explore', day: 'Thursday', start: '10:00', end: '11:15', age: 'Children aged 6 to 24 months', source: lambethSources.stockwell }),
    staticSession({ ...term, ...stockwell, name: 'Starting Solids Foods Workshop', day: 'Thursday', start: '09:30', end: '11:30', age: 'Parents and carers of babies', source: lambethSources.stockwell, dates: ['2026-09-10'] }),
    staticSession({ ...term, ...stockwell, name: 'Baby Chat', day: 'Friday', start: '10:00', end: '12:00', age: 'Expectant parents and parents with babies', source: lambethSources.stockwell, dates: ['2026-10-30', '2026-12-04'] }),
    staticSession({ ...term, postcode: 'SW2 2JE', name: 'Stay and Play', day: 'Monday', start: '09:45', end: '11:15', age: 'Children aged 0 to 4 years', source: lambethSources.jubilee }),
    staticSession({ ...term, postcode: 'SW2 2JE', name: 'Baby Massage', day: 'Monday', start: '10:00', end: '11:30', age: 'Parents and babies', source: lambethSources.jubilee, startDate: '2026-09-28', endDate: '2026-10-19' }),
    staticSession({ ...term, postcode: 'SW2 2JE', name: 'Toilet Training Workshop', day: 'Monday', start: '13:15', end: '15:15', age: 'Parents and carers of young children', source: lambethSources.jubilee, dates: ['2026-12-14'] }),
    staticSession({ ...term, postcode: 'SW2 2JE', name: 'Breathe Melodies for Mums - session 1', day: 'Tuesday', start: '10:00', end: '11:00', age: 'New mothers and their babies', source: lambethSources.jubilee, startDate: '2026-10-13', endDate: '2026-12-15' }),
    staticSession({ ...term, postcode: 'SW2 2JE', name: 'Breathe Melodies for Mums - session 2', day: 'Tuesday', start: '11:40', end: '13:00', age: 'New mothers and their babies', source: lambethSources.jubilee, startDate: '2026-10-13', endDate: '2026-12-15' }),
    staticSession({ ...term, postcode: 'SW2 2JE', name: 'Baby and Me', day: 'Wednesday', start: '10:00', end: '11:30', age: 'Babies aged 0 to 14 months', source: lambethSources.jubilee }),
    staticSession({ ...term, postcode: 'SW2 2JE', name: 'Making it REAL Learn and Play', day: 'Wednesday', start: '13:30', end: '14:30', age: 'Parents and children under 5', source: lambethSources.jubilee, startDate: '2026-11-04', endDate: '2026-11-25' }),
    staticSession({ ...term, postcode: 'SW2 2JE', name: 'Chat, Play and Read Stay and Play', day: 'Wednesday', start: '13:15', end: '15:15', age: 'Parents and children under 5', source: lambethSources.jubilee }),
    staticSession({ ...term, postcode: 'SW2 2JE', name: 'Little Twinkles SEND Stay and Play', day: 'Thursday', start: '09:45', end: '11:15', age: 'Children aged 0 to 4 years with SEND', source: lambethSources.jubilee, dates: ['2026-09-10', '2026-10-08', '2026-11-12', '2026-12-10'] }),
    staticSession({ ...term, postcode: 'SW2 2JE', name: 'Hear and Play', day: 'Thursday', start: '10:00', end: '12:00', age: 'Children with hearing impairments and their families', source: lambethSources.jubilee, dates: ['2026-09-17', '2026-10-15', '2026-11-19', '2026-12-17'] }),
    staticSession({ ...term, postcode: 'SW2 2JE', name: 'Breastfeeding Support Drop-in', day: 'Friday', start: '10:00', end: '12:00', age: 'Parents and babies', source: lambethSources.jubilee, booking: false }),
    staticSession({ ...term, postcode: 'SW2 2JE', name: 'Little Connections', day: 'Friday', start: '10:30', end: '11:45', age: 'Children with speech, language or communication needs', source: lambethSources.jubilee }),
    staticSession({ ...term, postcode: 'SW2 2JE', name: 'Share, Learn and Play Women\'s Group', day: 'Friday', start: '12:30', end: '14:30', age: 'Women with young children', source: lambethSources.jubilee }),
    staticSession({ ...term, postcode: 'SW2 2JE', name: 'Vamos a Jugar Stay and Play', day: 'Friday', start: '12:30', end: '14:30', age: 'Spanish- and Portuguese-speaking families with young children', source: lambethSources.jubilee }),
    staticSession({ ...term, postcode: 'SW2 2JE', name: 'Fussy Eating Workshop', day: 'Friday', start: '13:15', end: '15:15', age: 'Parents and carers of young children', source: lambethSources.jubilee, dates: ['2026-11-06'] }),
    staticSession({ ...term, postcode: 'SW4 8EG', name: 'Baby Sing Along', day: 'Tuesday', start: '10:00', end: '11:00', age: 'Babies aged 0 to 12 months and their parents or carers', source: lambethSources.maytree }),
    staticSession({ ...term, postcode: 'SW4 8EG', name: 'Baby Massage', day: 'Thursday', start: '10:00', end: '11:00', age: 'Parents with babies up to pre-crawling', source: lambethSources.maytree, startDate: '2026-10-08', endDate: '2026-11-05' }),
    staticSession({ ...term, postcode: 'SW4 8EG', name: 'Baby Yoga', day: 'Thursday', start: '13:00', end: '14:30', age: 'Parents with babies up to pre-crawling', source: lambethSources.maytree, startDate: '2026-11-05', endDate: '2026-12-17' }),
    staticSession({ ...term, postcode: 'SW4 8EG', name: 'Baby Chat', day: 'Friday', start: '10:00', end: '12:00', age: 'Expectant parents and parents with babies', source: lambethSources.maytree, dates: ['2026-10-09', '2026-11-13', '2026-12-18'] }),
    staticSession({ ...term, postcode: 'SE11 5BZ', name: 'Baby Explorers', day: 'Monday', start: '10:00', end: '11:30', age: 'Babies aged 0 to 12 months', source: lambethSources.henryFawcett }),
    staticSession({ ...term, postcode: 'SE11 5BZ', name: 'Toddler Explorers', day: 'Monday', start: '14:00', end: '16:00', age: 'Children aged 1 to 5 years', source: lambethSources.henryFawcett, booking: false }),
    staticSession({ ...term, postcode: 'SE11 5BZ', name: 'Fussy Eaters Workshop', day: 'Tuesday', start: '10:00', end: '12:00', age: 'Parents and carers of young children', source: lambethSources.henryFawcett, dates: ['2026-09-08'] }),
    staticSession({ ...term, postcode: 'SE11 5BZ', name: 'Starting Solid Foods Workshop', day: 'Tuesday', start: '10:00', end: '12:00', age: 'Parents and carers of babies', source: lambethSources.henryFawcett, dates: ['2026-12-01'] }),
    staticSession({ ...term, postcode: 'SE11 5BZ', name: 'Sensory Room Play', day: 'Tuesday', start: '13:00', end: '15:00', age: 'Parents, babies and young children', source: lambethSources.henryFawcett }),
    staticSession({ ...term, postcode: 'SE11 5BZ', name: 'Fussy Eaters Workshop', day: 'Wednesday', start: '10:00', end: '12:00', age: 'Parents and carers of young children', source: lambethSources.henryFawcett, dates: ['2026-10-07'] }),
    staticSession({ ...term, postcode: 'SE11 5BZ', name: 'Starting Solid Foods Workshop', day: 'Wednesday', start: '10:00', end: '12:00', age: 'Parents and carers of babies', source: lambethSources.henryFawcett, dates: ['2026-11-04'] }),
    staticSession({ ...term, postcode: 'SE11 5BZ', name: 'Yoga with Your Baby', day: 'Wednesday', start: '13:00', end: '15:00', age: 'Parents and babies', source: lambethSources.henryFawcett, startDate: '2026-09-16', endDate: '2026-10-21' }),
    staticSession({ ...term, postcode: 'SE11 5BZ', name: 'Sensory Room Play', day: 'Wednesday', start: '13:00', end: '15:00', age: 'Parents, babies and young children', source: lambethSources.henryFawcett }),
    staticSession({ ...term, postcode: 'SE11 5BZ', name: 'Together Time', day: 'Thursday', start: '10:00', end: '11:30', age: 'Parents and children under 5', source: lambethSources.henryFawcett, startDate: '2026-11-05', endDate: '2026-12-17' }),
    staticSession({ ...term, postcode: 'SE11 5BZ', name: 'Baby Massage for Arabic Speakers', day: 'Thursday', start: '13:00', end: '14:30', age: 'Arabic-speaking parents and babies', source: lambethSources.henryFawcett, startDate: '2026-09-10', endDate: '2026-10-08' }),
    staticSession({ ...term, postcode: 'SE11 5BZ', name: 'Sensory Room Play', day: 'Thursday', start: '13:00', end: '15:00', age: 'Parents, babies and young children', source: lambethSources.henryFawcett }),
    staticSession({ ...term, postcode: 'SE11 5BZ', name: 'Baby Chat', day: 'Friday', start: '09:30', end: '12:00', age: 'Expectant parents and parents with babies', source: lambethSources.henryFawcett, dates: ['2026-10-02', '2026-11-06', '2026-12-11'] }),
    staticSession({ ...term, postcode: 'SE11 5BZ', name: 'Chatterbox', day: 'Friday', start: '10:00', end: '11:00', age: 'Parents and children under 5', source: lambethSources.henryFawcett }),
    staticSession({ ...term, postcode: 'SE11 5BZ', name: 'SEND Chatterbox', day: 'Friday', start: '10:00', end: '11:00', age: 'Children with SEND and their parents or carers', source: lambethSources.henryFawcett, dates: ['2026-09-25', '2026-10-23', '2026-11-27'] }),
    staticSession({ ...term, postcode: 'SE27 9UD', name: 'Stay and Play', day: 'Monday', start: '09:30', end: '11:00', age: 'Children aged 0 to 4 years', source: lambethSources.bentonsLane }),
    staticSession({ ...term, postcode: 'SE27 9UD', name: 'Yoga with My Baby', day: 'Monday', start: '10:00', end: '11:30', age: 'Parents with babies under 6 months', source: lambethSources.bentonsLane, startDate: '2026-10-05', endDate: '2026-11-23' }),
    staticSession({ ...term, postcode: 'SE27 9UD', name: 'Baby Explorers', day: 'Monday', start: '13:00', end: '15:00', age: 'Babies aged 0 to 12 months', source: lambethSources.bentonsLane }),
    staticSession({ ...term, postcode: 'SE27 9UD', name: 'SEND Stay and Play', day: 'Monday', start: '13:00', end: '15:00', age: 'Children with SEND and their parents or carers', source: lambethSources.bentonsLane }),
    staticSession({ ...term, postcode: 'SE27 9UD', name: 'Stay and Play', day: 'Wednesday', start: '13:00', end: '15:00', age: 'Children aged 0 to 4 years', source: lambethSources.bentonsLane }),
    staticSession({ ...term, postcode: 'SE27 9UD', name: 'Fussy Eating Workshop', day: 'Wednesday', start: '13:00', end: '15:00', age: 'Parents and carers of young children', source: lambethSources.bentonsLane, dates: ['2026-09-23', '2026-10-14'] }),
    staticSession({ ...term, postcode: 'SE27 9UD', name: 'Chattertime', day: 'Thursday', start: '09:30', end: '11:00', age: 'Parents and children under 5', source: lambethSources.bentonsLane }),
    staticSession({ ...term, postcode: 'SE27 9UD', name: 'Baby Explorers', day: 'Thursday', start: '13:00', end: '15:00', age: 'Babies aged 0 to 12 months', source: lambethSources.bentonsLane }),
    staticSession({ ...term, postcode: 'SE27 9UD', name: 'Starting Solids Workshop', day: 'Thursday', start: '13:00', end: '15:00', age: 'Parents and carers of babies', source: lambethSources.bentonsLane, dates: ['2026-12-09'] }),
    staticSession({ ...term, postcode: 'SE27 9UD', name: 'Outdoor Stay and Play and Natural Thinkers', day: 'Friday', start: '09:30', end: '11:00', age: 'Children aged 12 months to 4 years', source: lambethSources.bentonsLane }),
  ];
}

function sessionsForMerton() {
  const term = { startDate: '2026-09-01', endDate: '2026-10-23', booking: true };
  return [
    staticSession({ ...term, postcode: 'CR4 1SD', name: 'Antenatal Breastfeeding Support Group', day: 'Monday', start: '09:45', end: '10:30', age: 'Expectant parents', source: mertonSources.acacia, booking: false }),
    staticSession({ ...term, postcode: 'CR4 1SD', name: 'Early Learning Together', day: 'Monday', start: '14:00', end: '15:30', age: 'Babies aged 0 to 6 months', source: mertonSources.acacia, startDate: '2026-09-14' }),
    staticSession({ ...term, postcode: 'CR4 1SD', name: 'Little Moments Together', day: 'Monday', start: '10:00', end: '11:30', age: 'Babies aged 0 to 12 months', source: mertonSources.acacia, booking: false }),
    staticSession({ ...term, postcode: 'CR4 1SD', name: 'Breastfeeding Support Drop-in Group', day: 'Monday', start: '10:30', end: '12:00', age: 'Parents and babies', source: mertonSources.acacia, booking: false }),
    staticSession({ ...term, postcode: 'CR4 1SD', name: 'Early Learning Together', day: 'Tuesday', start: '09:30', end: '11:00', age: 'Children aged 12 to 18 months', source: mertonSources.acacia, startDate: '2026-09-15' }),
    staticSession({ ...term, postcode: 'CR4 1SD', name: 'Early Learning Together', day: 'Tuesday', start: '14:00', end: '15:30', age: 'Babies aged 6 to 12 months', source: mertonSources.acacia, startDate: '2026-09-15' }),
    staticSession({ ...term, postcode: 'CR4 1SD', name: 'Early Learning Together', day: 'Wednesday', start: '09:30', end: '11:00', age: 'Children aged 19 to 36 months', source: mertonSources.acacia, startDate: '2026-09-16' }),
    staticSession({ ...term, postcode: 'CR4 1SD', name: 'Social Communication Group', day: 'Thursday', start: '13:00', end: '14:30', age: 'Children aged 2 to 3 with communication needs', source: mertonSources.acacia }),
    staticSession({ ...term, postcode: 'CR4 1SD', name: 'Portage Parenting', day: 'Thursday', start: '10:00', end: '11:30', age: 'Children with significant additional needs and their families', source: mertonSources.acacia }),
    staticSession({ ...term, postcode: 'CR4 1SD', name: 'Get Together', day: 'Friday', start: '10:00', end: '11:30', age: 'Children aged 0 to 5 years', source: mertonSources.acacia, booking: false }),
    staticSession({ ...term, postcode: 'CR4 1SD', name: 'Nurture Together Postnatal Support Group', day: 'Friday', start: '13:30', end: '15:00', age: 'Parents and children aged 0 to 2 years', source: mertonSources.acacia }),
    staticSession({ ...term, postcode: 'CR4 3BH', name: 'Get Together', day: 'Monday', start: '10:00', end: '11:30', age: 'Children aged 0 to 5 years', source: mertonSources.churchRoad, booking: false }),
    staticSession({ ...term, postcode: 'CR4 3BH', name: 'Early Learning Together', day: 'Monday', start: '14:00', end: '15:30', age: 'Babies aged 0 to 6 months', source: mertonSources.churchRoad, startDate: '2026-09-14' }),
    staticSession({ ...term, postcode: 'CR4 3BH', name: 'Growing Well Together', day: 'Tuesday', start: '10:00', end: '11:30', age: 'Parents and children aged 2 to 5 years', source: mertonSources.churchRoad, startDate: '2026-09-15' }),
    staticSession({ ...term, postcode: 'CR4 3BH', name: 'Small Steps Together', day: 'Tuesday', start: '13:30', end: '15:00', age: 'Children aged 0 to 5 with additional needs', source: mertonSources.churchRoad, booking: false }),
    staticSession({ ...term, postcode: 'CR4 3BH', name: 'Early Learning Together', day: 'Tuesday', start: '10:00', end: '11:30', age: 'Babies aged 0 to 6 months', source: mertonSources.churchRoad, startDate: '2026-09-15' }),
    staticSession({ ...term, postcode: 'CR4 3BH', name: 'Introduction to Solids Workshop', day: 'Wednesday', start: '14:00', end: '16:00', age: 'Parents with babies aged 16 to 26 weeks', source: mertonSources.churchRoad, dates: ['2026-10-21'] }),
    staticSession({ ...term, postcode: 'CR4 3BH', name: 'Young Parents Playgroup', day: 'Wednesday', start: '13:15', end: '15:00', age: 'Parents aged 24 and under with children up to 3 years', source: mertonSources.churchRoad, booking: false }),
    staticSession({ ...term, postcode: 'CR4 3BH', name: 'Little Moments Together', day: 'Wednesday', start: '10:00', end: '11:30', age: 'Babies aged 0 to 12 months', source: mertonSources.churchRoad, booking: false }),
    staticSession({ ...term, postcode: 'CR4 3BH', name: 'Brighter Futures', day: 'Thursday', start: '10:00', end: '12:00', age: 'Children from 18 months and their parents', source: mertonSources.churchRoad, startDate: '2026-09-10' }),
    staticSession({ ...term, postcode: 'CR4 3BH', name: 'Early Learning Together', day: 'Thursday', start: '10:00', end: '11:30', age: 'Babies aged 6 to 12 months', source: mertonSources.churchRoad, startDate: '2026-09-17' }),
    staticSession({ ...term, postcode: 'CR4 3BH', name: 'Early Learning Together', day: 'Thursday', start: '13:30', end: '15:00', age: 'Children aged 19 to 36 months', source: mertonSources.churchRoad, startDate: '2026-09-17' }),
    staticSession({ ...term, postcode: 'CR4 3BH', name: 'Best Start Triple P', day: 'Friday', start: '09:30', end: '11:30', age: 'Parents of children aged 3 to 4 years', source: mertonSources.churchRoad, startDate: '2026-09-25' }),
  ];
}

async function fetchHtml(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(30000),
      });
      if (response.ok) return response.text();
      lastError = new Error(`${new URL(url).hostname} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
  }
  throw lastError || new Error(`Could not load ${url}`);
}

function firstActivityName(html) {
  const candidates = [...html.matchAll(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi)]
    .map((match) => cleanText(match[1]))
    .filter((value) => value && !/^(?:age|time|session details?|session \d+|notes?|date and time)$/i.test(value));
  return (candidates[0] || '').replace(/\s*-\s*no session\b.*$/i, '').trim();
}

function parseHounslowPage(page, html) {
  const headings = [...html.matchAll(/<h2\b[^>]*class=["'][^"']*cms-widget-title[^"']*["'][^>]*>([\s\S]*?)<\/h2>/gi)];
  const rows = [];
  for (const heading of headings) {
    const day = weekdayFromHeading(cleanText(heading[1]));
    if (!day) continue;
    const start = heading.index + heading[0].length;
    const nextWidget = html.indexOf('<div class="cms-widget">', start);
    const block = html.slice(start, nextWidget > start ? nextWidget : html.length);
    for (const item of block.split(/<hr\b[^>]*>/i)) {
      const name = firstActivityName(item);
      const details = cleanText(item);
      if (!isFamilyActivitySession(name, details)) continue;
      const ranges = parseTimeRanges(details);
      for (const [index, range] of ranges.entries()) {
        const corrected = { ...range };
        if (corrected.start_time >= '20:00' && corrected.end_time > corrected.start_time) {
          corrected.start_time = `${String(Number(corrected.start_time.slice(0, 2)) - 12).padStart(2, '0')}:${corrected.start_time.slice(3)}`;
          corrected.end_time = `${String(Number(corrected.end_time.slice(0, 2)) - 12).padStart(2, '0')}:${corrected.end_time.slice(3)}`;
        }
        rows.push(staticSession({
          postcode: page.postcode,
          name: ranges.length > 1 ? `${name} - session ${index + 1}` : name,
          day,
          start: corrected.start_time,
          end: corrected.end_time,
          age: ageForFamilyHubSession(name, details),
          source: page.url,
          description: details,
          booking: /book(?:ing|ed)?|appointment|invite|referral/i.test(details),
          startDate: '2026-09-01',
          endDate: '2026-12-21',
          notes: `${page.label} current weekly timetable. Check the source for cancellations, referral rules and term-time notes.`,
        }));
      }
    }
  }
  return rows;
}

function htmlHeadingTokens(html) {
  return [...html.matchAll(/<(h2|h3|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => ({ tag: match[1].toLowerCase(), text: cleanText(match[2]) }))
    .filter((token) => token.text);
}

function parseHammersmithPage(page, html) {
  const tokens = htmlHeadingTokens(html);
  const start = tokens.findIndex((token) => /timetables? of (?:weekly )?activities|activities and sessions/i.test(token.text));
  if (start < 0) return [];
  const rows = [];
  let day = null;
  for (let index = start + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (/young people and adults activities/i.test(token.text)) break;
    const headingDay = weekdayFromHeading(token.text);
    if (headingDay && token.tag === 'h2') {
      day = headingDay;
      continue;
    }
    if (token.tag !== 'h3' || !day) continue;
    const detailTokens = [];
    let next = index + 1;
    while (next < tokens.length && tokens[next].tag !== 'h3' && !weekdayFromHeading(tokens[next].text)) {
      if (/young people and adults activities/i.test(tokens[next].text)) break;
      detailTokens.push(tokens[next].text);
      next += 1;
    }
    const details = cleanText(detailTokens.join(' '));
    if (!isFamilyActivitySession(token.text, details)) continue;
    const ranges = parseTimeRanges(details);
    for (const [rangeIndex, range] of ranges.entries()) {
      const corrected = { ...range };
      // The Old Oak source contains one obvious 9.30pm typo for an under-5
      // morning Learn and Play; its booking text repeats the intended 9.30am.
      if (corrected.start_time >= '20:00' && /under\s*5|newborn|baby/i.test(details)) {
        corrected.start_time = `${String(Number(corrected.start_time.slice(0, 2)) - 12).padStart(2, '0')}:${corrected.start_time.slice(3)}`;
        corrected.end_time = `${String(Number(corrected.end_time.slice(0, 2)) - 12).padStart(2, '0')}:${corrected.end_time.slice(3)}`;
      }
      rows.push(staticSession({
        postcode: page.postcode,
        name: ranges.length > 1 ? `${token.text} - session ${rangeIndex + 1}` : token.text,
        day,
        start: corrected.start_time,
        end: corrected.end_time,
        age: ageForFamilyHubSession(token.text, details),
        source: page.url,
        description: details,
        booking: /book(?:ing|ed)?|appointment|invite|referral/i.test(details),
        notes: `${page.label} current weekly timetable. Check the source for booking requirements, selected dates and term-time changes.`,
      }));
    }
  }
  return rows;
}

async function dynamicSessions() {
  const audit = [];
  const groups = [
    ...hounslowPages.map((page) => ({ page, parser: parseHounslowPage, provider: 'Hounslow' })),
    ...hammersmithPages.map((page) => ({ page, parser: parseHammersmithPage, provider: 'Hammersmith and Fulham' })),
  ];
  const results = await Promise.all(groups.map(async ({ page, parser, provider }) => {
    try {
      const rows = parser(page, await fetchHtml(page.url));
      audit.push({ provider, url: page.url, postcode: normalisePostcode(page.postcode), status: rows.length ? 'ready' : 'empty', sessions: rows.length });
      return rows;
    } catch (error) {
      audit.push({ provider, url: page.url, postcode: normalisePostcode(page.postcode), status: 'failed', sessions: 0, reason: error.message });
      return [];
    }
  }));
  return { rows: results.flat(), audit };
}

function sourceUrlFor(session) {
  const identity = [
    normalisePostcode(session.venue_postcode || session.hub_postcode), session.activity_name, session.day,
    session.start_time, session.end_time, ...(session.available_dates || []),
  ].join('|').toLowerCase();
  const hash = createHash('sha1').update(identity).digest('hex').slice(0, 16);
  const url = new URL(session.source_page_url);
  url.hash = `tiny-outings-session-${hash}`;
  return url.toString();
}

function sql(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return `$$${String(value).replaceAll('$$', '$ $')}$$`;
}

function sqlArray(values) {
  const unique = [...new Set((values || []).filter(Boolean))];
  return unique.length ? `array[${unique.map(sql).join(', ')}]` : "'{}'";
}

function sessionValues(session) {
  const dates = [...new Set(session.available_dates || [])].sort();
  const availabilityType = dates.length ? (dates.length === 1 ? 'one_off' : 'specific_dates') : 'weekly';
  const activityDate = dates.length === 1 ? dates[0] : null;
  return `(${[
    sql(normalisePostcode(session.hub_postcode)),
    sql(normalisePostcode(session.venue_postcode || session.hub_postcode)),
    sql(session.venue_address),
    sql(session.activity_name),
    sql(session.category),
    sql(session.start_time),
    sql(session.end_time),
    sqlArray([session.day]),
    sql(session.schedule_notes),
    sql(session.description),
    sql('Free'),
    session.booking_required ? 'true' : 'false',
    sql(sourceUrlFor(session)),
    sql(session.source_page_url),
    sql(activityDate),
    `${sqlArray(dates)}::date[]`,
    sql(session.availability_start_date),
    sql(session.availability_end_date),
    sqlArray([session.day]),
    sql(availabilityType),
    sql(session.schedule_notes),
    sql(session.age_suitability),
  ].join(', ')})`;
}

function safeImage(column) {
  return `case
      when regexp_replace(replace(lower(coalesce(session.category, '')), '&', 'and'), '[^a-z0-9]+', ' ', 'g') in ('parks and outdoor play', 'museums and culture', 'family activities') then hub.${column}
      when coalesce(hub.${column}, '') !~* '(wikimedia(?:\\.org| commons)|wikipedia(?:\\.org)?)' then hub.${column}
      else null
    end`;
}

function buildSql(rows) {
  if (!rows.length) return '-- No validated current family-hub timetable sessions found.\n';
  const centreMappings = [...new Map(rows.map((row) => {
    const legacyPostcode = normalisePostcode(row.hub_postcode);
    return [legacyPostcode, {
      legacyPostcode,
      venuePostcode: normalisePostcode(row.venue_postcode || row.hub_postcode),
    }];
  })).values()];
  const inputColumns = [
    'hub_postcode', 'venue_postcode', 'venue_address', 'activity_name', 'category', 'start_time', 'end_time', 'days_of_week', 'schedule_notes', 'description', 'cost',
    'booking_required', 'source_url', 'website', 'activity_date', 'available_dates', 'availability_start_date', 'availability_end_date',
    'available_days_of_week', 'availability_type', 'availability_notes', 'age_suitability',
  ];
  const insertColumns = [
    'activity_name', 'address', 'postcode', 'lat', 'long', 'category', 'start_time', 'end_time', 'google_link', 'website', 'organiser_website',
    'child_friendly_score', 'app_rating', 'number_of_reviews', 'age_suitability', 'borough', 'days_of_week', 'recurrence_rule', 'schedule_notes',
    'description', 'cost', 'booking_required', 'source_name', 'source_url', 'data_source', 'google_place_id', 'google_place_uri', 'google_primary_type',
    'activity_date', 'available_dates', 'availability_start_date', 'availability_end_date', 'available_days_of_week', 'availability_type',
    'availability_notes', 'public_listing_status', 'admin_cover_image_url', 'reviewed_image_url', 'reviewed_image_source_url',
    'reviewed_image_original_url', 'reviewed_image_selected_at', 'reviewed_image_model', 'reviewed_image_selected_by_user_id', 'user_image_url',
    'model_selected_url', 'organiser_website_downloaded_image', 'website_downloaded_image', 'wikimedia_image_url', 'website_image_url',
    'listing_image_url', 'archive',
  ];
  const updateColumns = [
    'activity_name', 'address', 'postcode', 'lat', 'long', 'category', 'start_time', 'end_time', 'google_link', 'website', 'organiser_website',
    'age_suitability', 'borough', 'days_of_week', 'schedule_notes', 'description', 'cost', 'booking_required', 'source_name', 'data_source',
    'google_place_id', 'google_place_uri', 'google_primary_type', 'activity_date', 'available_dates', 'availability_start_date',
    'availability_end_date', 'available_days_of_week', 'availability_type', 'availability_notes', 'public_listing_status', 'archive',
  ];
  const sourceSelect = [
    'session.activity_name', 'coalesce(session.venue_address, hub.address)', 'coalesce(session.venue_postcode, hub.postcode)', 'hub.lat', 'hub.long', 'session.category', 'session.start_time::time', 'session.end_time::time',
    'hub.google_link', 'session.website', 'hub.organiser_website', 'hub.child_friendly_score', 'hub.app_rating', 'hub.number_of_reviews',
    'session.age_suitability', 'hub.borough', 'session.days_of_week', 'null', 'session.schedule_notes', 'session.description', 'session.cost',
    'session.booking_required', sql(sourceName), 'session.source_url', sql('Official family hub timetable'), 'hub.google_place_id', 'hub.google_place_uri',
    'hub.google_primary_type', 'session.activity_date::date', 'session.available_dates', 'session.availability_start_date::date',
    'session.availability_end_date::date', 'session.available_days_of_week', 'session.availability_type', 'session.availability_notes',
    "case when hub.public_listing_status = 'published' then 'published' else 'draft' end",
  ];

  // Keep image metadata in the same order as insertColumns. The safe image
  // expressions are spliced into their corresponding hierarchy positions.
  const orderedSourceSelect = [
    ...sourceSelect,
    safeImage('admin_cover_image_url'), safeImage('reviewed_image_url'), safeImage('reviewed_image_source_url'), safeImage('reviewed_image_original_url'),
    'hub.reviewed_image_selected_at', 'hub.reviewed_image_model', 'hub.reviewed_image_selected_by_user_id', safeImage('user_image_url'),
    safeImage('model_selected_url'), safeImage('organiser_website_downloaded_image'), safeImage('website_downloaded_image'), safeImage('wikimedia_image_url'),
    safeImage('website_image_url'), safeImage('listing_image_url'), 'false',
  ];

  return `-- Generated by scripts/import-london-family-hubs.js
-- Replaces generic draft venue cards when real named and timed sessions have
-- been verified. A live generic card stays live until its replacement is
-- approved and published through the admin review queue.

with input_sessions (${inputColumns.join(', ')}) as (
  values
    ${rows.map(sessionValues).join(',\n    ')}
),
legacy_hubs as (
  select *
  from public.activities
  where source_name = ${sql(legacySourceName)}
    and (
      coalesce(archive, false) = false
      or archive_reason = 'Replaced by named and timed activities from the official family hub timetable.'
    )
)
insert into public.activities (
  ${insertColumns.join(',\n  ')}
)
select
  ${orderedSourceSelect.join(',\n  ')}
from input_sessions session
join legacy_hubs hub
  on upper(regexp_replace(coalesce(hub.postcode, ''), '\\s+', '', 'g')) = session.hub_postcode
on conflict (source_url) do update set
  ${updateColumns.map((column) => `${column} = excluded.${column}`).join(',\n  ')},
  updated_at = now();

update public.activities as legacy
set public_listing_status = 'archived',
    archive = true,
    archive_reason = 'Replaced by named and timed activities from the official family hub timetable.',
    updated_at = now()
where legacy.source_name = ${sql(legacySourceName)}
  and coalesce(legacy.archive, false) = false
  and exists (
    select 1
    from (values
      ${centreMappings.map((mapping) => `(${sql(mapping.legacyPostcode)}, ${sql(mapping.venuePostcode)})`).join(',\n      ')}
    ) as mapping(legacy_postcode, venue_postcode)
    join public.activities replacement
      on upper(regexp_replace(coalesce(replacement.postcode, ''), '\\s+', '', 'g')) = mapping.venue_postcode
    where replacement.source_name = ${sql(sourceName)}
      and coalesce(replacement.archive, false) = false
      and mapping.legacy_postcode = upper(regexp_replace(coalesce(legacy.postcode, ''), '\\s+', '', 'g'))
      and (
        legacy.public_listing_status <> 'published'
        or replacement.public_listing_status = 'published'
      )
  );

-- Waltham Forest already has a dedicated live-events importer. Remove its
-- remaining generic hub cards only where a real Best Start event is present.
update public.activities as legacy
set public_listing_status = 'archived',
    archive = true,
    archive_reason = 'Replaced by Waltham Forest Best Start event listings with dates and times.',
    updated_at = now()
where legacy.source_name = ${sql(legacySourceName)}
  and legacy.borough = 'Waltham Forest'
  and coalesce(legacy.archive, false) = false
  and exists (
    select 1
    from public.activities replacement
    where replacement.source_name = 'Waltham Forest Best Start in Life events'
      and coalesce(replacement.archive, false) = false
      and replacement.public_listing_status = 'published'
  );
`;
}

async function main() {
  const fixed = [
    ...sessionsForBarking(),
    ...sessionsForCamden(),
    ...sessionsForLambeth(),
    ...sessionsForMerton(),
  ];
  const dynamic = await dynamicSessions();
  const candidates = [...fixed, ...dynamic.rows];
  const validationFailures = [];
  const deduplicated = new Map();
  for (const session of candidates) {
    const errors = validateFamilyHubSession(session);
    if (errors.length) {
      validationFailures.push({ session, errors });
      continue;
    }
    const key = sourceUrlFor(session);
    deduplicated.set(key, session);
  }
  const rows = [...deduplicated.values()].sort((left, right) => (
    left.hub_postcode.localeCompare(right.hub_postcode)
    || left.day.localeCompare(right.day)
    || left.start_time.localeCompare(right.start_time)
    || left.activity_name.localeCompare(right.activity_name)
  ));

  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, buildSql(rows));
  writeFileSync(outputAudit, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    sessions: rows.length,
    centres_covered: [...new Set(rows.map((row) => normalisePostcode(row.hub_postcode)))].sort(),
    sessions_by_centre: Object.fromEntries([...new Set(rows.map((row) => normalisePostcode(row.hub_postcode)))].sort().map((postcode) => [
      postcode,
      rows.filter((row) => normalisePostcode(row.hub_postcode) === postcode).length,
    ])),
    dynamic_sources: dynamic.audit.sort((left, right) => left.url.localeCompare(right.url)),
    current_source_gaps: currentSourceGaps,
    validation_failures: validationFailures,
    policy: {
      generic_cards_archived_only_after_replacement_exists: true,
      published_generic_cards_retained_until_replacement_published: true,
      waltham_forest_uses_dedicated_live_event_importer: true,
      excluded: 'opening hours, generic advice, administrative support, appointment clinics and other non-activity services',
    },
  }, null, 2)}\n`);
  console.log(`Prepared ${rows.length} named and timed family-hub sessions across ${new Set(rows.map((row) => normalisePostcode(row.hub_postcode))).size} centres.`);
  if (validationFailures.length) console.warn(`Skipped ${validationFailures.length} invalid candidate sessions; see ${outputAudit}.`);
  if (dynamic.audit.some((source) => source.status !== 'ready')) console.warn('One or more live timetable pages failed or returned no activity sessions; see the generated audit.');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
