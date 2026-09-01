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
  materialiseFamilyHubSessionDates,
  normalisePostcode,
  parseTimeRanges,
  validateFamilyHubSession,
  weekdayFromHeading,
} from './lib/family-hub-timetable-policy.js';
import { loadGreenwichFamilyDirectorySessions } from './lib/greenwich-family-directory.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputSql = join(root, 'supabase', 'seed', 'activities_london_family_hub_timetables.generated.sql');
const outputAudit = join(root, 'data', 'london_family_hub_timetables_import.generated.json');
const sourceName = 'London family hub official timetables';
const legacySourceName = 'GOV.UK Family Hubs and Start for Life';
const genericReplacementReason = 'Replaced by named and timed activities from the official family hub timetable.';
const publishedGenericReplacementReason = `${genericReplacementReason} Previous listing status: published.`;
const unverifiableGenericReason = 'Generic government directory card removed: no verified current named activity with exact dates and start/end times.';
const scheduleGuardArchiveReason = 'Scheduled family activity removed: no verified exact occurrence date and start/end time.';
const specificityGuardArchiveReason = 'Scheduled family activity removed: generic venue card or no verified exact occurrence date and start/end time.';
const userAgent = 'Mozilla/5.0 (compatible; TinyOutings/1.0; +https://tiny-outings-cpjh.onrender.com)';

const camdenSource = 'https://families.camden.gov.uk/full-stay-play-timetable/';
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
const brentThreeTreesSource = 'https://www.brent.gov.uk/-/media/files/resident-documents/children-young-people-families-documents/family-wellbeing-centres/three-trees-family-wellbeing-centre-schedule.pdf?hash=A1A59AB18BB7D84FAE8FEE3ACDE1514E&rev=ef4070df3fe44d808998e7b549f7dab5';
const croydonWoodlandsSource = 'https://www.croydon.gov.uk/sites/default/files/2026-07/woodlands-family-hub-timetable-summer-26_0.pdf';
const lewishamSources = {
  bellingham: 'https://lewishamfamilyhubs.org.uk/assets/519a225a/bellingham_timetable_with_back_page_autumn_26_2.pdf',
  deptford: 'https://lewishamfamilyhubs.org.uk/assets/519a225a/deptford_timetable_with_back_page_autumn_26_010926pm.pdf',
  ladywell: 'https://lewishamfamilyhubs.org.uk/assets/519a225a/3_ladywell_timetable_autumn_26_updated010926.pdf',
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
    borough: 'Barking and Dagenham',
    legacy_postcodes: ['IG117NB', 'RM109QS', 'RM65NJ'],
    source: 'https://www.lbbd.gov.uk/events/stay-and-play-0-5-years-old-valence-library',
    reason: 'The current council page publishes weekly opening times but no exact session dates, so these legacy venue cards remain archived.',
  },
  {
    borough: 'Brent',
    legacy_postcodes: ['HA04PW', 'NW98JD', 'NW109SD', 'HA98RJ', 'HA99YP'],
    source: 'https://www.brent.gov.uk/familywellbeingcentres',
    reason: 'No current exact timetable was published for these five legacy centres; Three Trees is covered by its September-to-December timetable.',
  },
  {
    borough: 'Croydon',
    legacy_postcodes: ['SE256XX'],
    source: 'https://www.croydon.gov.uk/children-young-people-and-families/family-hubs',
    reason: 'The current North and Central timetable does not publish an activity at the Samuel Coleridge Taylor legacy venue; Woodlands is covered through its exact published end date.',
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
    legacy_postcodes: ['SE83PZ', 'SE64JF'],
    source: 'https://lewishamfamilyhubs.org.uk/p/whats-on/activities-and-timetables',
    reason: 'The current timetable page covers Bellingham, Deptford and Ladywell; no current exact timetable maps to the Evelyn or Kaleidoscope legacy cards.',
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
  excludeDates = [],
  notes = null,
  category = null,
  cost = 'Free',
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
    excluded_dates: excludeDates,
    schedule_notes: notes || 'Official family hub timetable. Check the source page for cancellations or booking changes.',
    cost,
  };
}

function sessionsForCamden() {
  const autumnTerm = { startDate: '2026-09-02', endDate: '2026-12-18' };
  const halfTermDates = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];
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
  return rows.map(([name, postcode, day, start, end, age]) => {
    const termTimeOnly = /Superstars|KIDS Early Years|Nurture and Nourish/i.test(name);
    const dateSpecificExceptions = postcode === 'NW1 1HQ'
      ? ['2026-09-02', '2026-09-11']
      : [];
    return staticSession({
      ...autumnTerm,
      postcode,
      name,
      day,
      start,
      end,
      age,
      source: camdenSource,
      excludeDates: [...(termTimeOnly ? halfTermDates : []), ...dateSpecificExceptions],
      description: `${name}, from Camden's current full Stay and Play timetable.`,
      notes: 'Camden Stay and Play timetable, materialised as exact Autumn 2026 dates with published term-time and date-specific exclusions applied.',
    });
  });
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
    staticSession({ ...term, postcode: 'SE27 9UD', name: 'Starting Solids Workshop', day: 'Wednesday', start: '13:00', end: '15:00', age: 'Parents and carers of babies', source: lambethSources.bentonsLane, dates: ['2026-12-09'] }),
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

function autumnHalfTermDates() {
  return ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];
}

function sessionsForBrent() {
  const term = { postcode: 'NW10 3HL', source: brentThreeTreesSource, startDate: '2026-09-01', endDate: '2026-12-18' };
  const halfTerm = autumnHalfTermDates();
  return [
    staticSession({ ...term, name: 'Art Club', day: 'Monday', start: '16:00', end: '17:15', age: 'Children aged 5 to 11 years', category: 'Arts & crafts', booking: true, excludeDates: halfTerm }),
    staticSession({ ...term, name: 'Stay, Play and Learn', day: 'Tuesday', start: '09:45', end: '10:45', age: 'Children aged 1 year and over', booking: true, excludeDates: halfTerm }),
    staticSession({ ...term, name: 'Mum and Baby Yoga', day: 'Wednesday', start: '10:00', end: '11:00', age: 'Babies aged 6 weeks to 1 year', category: 'Baby dance & movement', excludeDates: halfTerm }),
    staticSession({ ...term, name: 'Messy Play', day: 'Wednesday', start: '11:30', end: '12:30', age: 'Children aged 18 months and over', category: 'Arts & crafts' }),
    staticSession({ ...term, name: 'Introduction to Solids', day: 'Wednesday', start: '15:00', end: '16:30', age: 'Babies aged 6 months and over', category: 'Feeding & postnatal support', booking: true, dates: ['2026-09-09', '2026-10-14', '2026-11-11', '2026-12-09'] }),
    staticSession({ ...term, name: 'Baby Time', day: 'Friday', start: '11:45', end: '13:15', age: 'Babies under 1', excludeDates: halfTerm, booking: true }),
    staticSession({ ...term, name: 'Perinatal Workshop - Stress, Anxiety and Sleep', day: 'Friday', start: '13:15', end: '14:15', age: 'Parents and babies under 1', category: 'Feeding & postnatal support', booking: true, dates: ['2026-09-04'] }),
    staticSession({ ...term, name: 'Perinatal Workshop - Mum and Baby Mindfulness', day: 'Friday', start: '13:15', end: '14:15', age: 'Parents and babies under 1', category: 'Feeding & postnatal support', booking: true, dates: ['2026-09-11'] }),
    staticSession({ ...term, name: 'Perinatal Workshop - Low Mood', day: 'Friday', start: '13:15', end: '14:15', age: 'Parents and babies under 1', category: 'Feeding & postnatal support', booking: true, dates: ['2026-09-18'] }),
    staticSession({ ...term, name: 'Perinatal Workshop - Adjusting to Motherhood', day: 'Friday', start: '13:15', end: '14:15', age: 'Parents and babies under 1', category: 'Feeding & postnatal support', booking: true, dates: ['2026-09-25'] }),
  ];
}

function sessionsForCroydon() {
  const common = { postcode: 'CR2 8HD', source: croydonWoodlandsSource, age: 'Children aged 0 to 9 years' };
  return [
    staticSession({ ...common, name: 'Stay and Play', day: 'Tuesday', start: '09:30', end: '11:00', dates: ['2026-09-01'] }),
    staticSession({ ...common, name: 'Chatterbox', day: 'Tuesday', start: '13:00', end: '14:30', dates: ['2026-09-01'], age: 'Children needing speech, language and communication support' }),
    staticSession({ ...common, name: 'Stay and Play', day: 'Thursday', start: '13:00', end: '14:30', dates: ['2026-09-03'] }),
    staticSession({ ...common, name: 'Baby Fun for Under 1s', day: 'Friday', start: '09:30', end: '11:00', dates: ['2026-09-04'], age: 'Babies under 1' }),
    staticSession({ ...common, name: 'Infant Feeding Support', day: 'Friday', start: '10:00', end: '11:30', dates: ['2026-09-04'], age: 'Parents and babies', category: 'Feeding & postnatal support' }),
    staticSession({ ...common, name: 'Childminders Session', day: 'Friday', start: '10:00', end: '11:30', dates: ['2026-09-04'], age: 'Childminders and young children', booking: true }),
  ];
}

function sessionsForLewisham() {
  const halfTerm = autumnHalfTermDates();
  const term = { startDate: '2026-09-01', endDate: '2026-12-18', excludeDates: halfTerm };
  const bellingham = { ...term, postcode: 'SE6 3HB', source: lewishamSources.bellingham };
  const deptford = { ...term, postcode: 'SE8 5NH', source: lewishamSources.deptford };
  const ladywell = { ...term, postcode: 'SE4 1JJ', source: lewishamSources.ladywell };
  return [
    staticSession({ ...bellingham, name: 'Baby Stay and Play', day: 'Monday', start: '10:00', end: '11:30', age: 'Babies aged 0 to 18 months' }),
    staticSession({ ...bellingham, name: 'Stay and Play', day: 'Monday', start: '13:15', end: '14:45', age: 'Children aged 0 to 5 years' }),
    staticSession({ ...bellingham, name: 'Explorers Plus with Portage', day: 'Tuesday', start: '10:00', end: '11:30', age: 'Children from birth to 5 years' }),
    staticSession({ ...bellingham, name: 'Breastfeeding Hub', day: 'Tuesday', start: '13:00', end: '15:00', age: 'Parents and babies', category: 'Feeding & postnatal support' }),
    staticSession({ ...bellingham, name: 'Rhythm and Rhyme', day: 'Wednesday', start: '09:30', end: '10:30', age: 'Children aged 0 to 5 years' }),
    staticSession({ ...bellingham, name: 'Togetherness - Understanding Your Baby Postnatal Group', day: 'Wednesday', start: '13:00', end: '15:00', age: 'Parents and babies aged 0 to 10 months', booking: true, startDate: '2026-09-16', endDate: '2026-12-09' }),
    staticSession({ ...bellingham, name: 'Baby Messy Play', day: 'Friday', start: '10:00', end: '11:30', age: 'Babies aged 0 to 18 months', category: 'Arts & crafts' }),
    staticSession({ ...bellingham, name: 'Dads and Male Carers Stay and Play', day: 'Saturday', start: '10:00', end: '12:00', age: 'Dads, male carers and their children', dates: ['2026-10-17', '2026-12-19'] }),

    staticSession({ ...deptford, name: 'Stay and Play', day: 'Monday', start: '09:30', end: '11:00', age: 'Children aged 0 to 5 years' }),
    staticSession({ ...deptford, name: 'Baby Stay and Play', day: 'Monday', start: '13:15', end: '14:45', age: 'Babies aged 0 to 18 months' }),
    staticSession({ ...deptford, name: 'Maternal Journaling with the PAIRS Team', day: 'Tuesday', start: '10:00', end: '11:30', age: 'Mothers and children up to 3 years', category: 'Feeding & postnatal support', booking: true, startDate: '2026-09-01', endDate: '2026-10-06' }),
    staticSession({ ...deptford, name: 'Maternal Journaling with the PAIRS Team', day: 'Tuesday', start: '10:00', end: '11:30', age: 'Mothers and children up to 3 years', category: 'Feeding & postnatal support', booking: true, startDate: '2026-11-03', endDate: '2026-12-08' }),
    staticSession({ ...deptford, name: 'Stay and Play', day: 'Tuesday', start: '13:30', end: '15:00', age: 'Children aged 0 to 5 years' }),
    staticSession({ ...deptford, name: 'Rhythm and Rhyme', day: 'Wednesday', start: '09:30', end: '10:30', age: 'Children aged 0 to 5 years' }),
    staticSession({ ...deptford, name: 'Owl Babies', day: 'Wednesday', start: '11:30', end: '12:30', age: 'Babies aged 0 to 6 months', booking: true, startDate: '2026-09-23', endDate: '2026-10-21' }),
    staticSession({ ...deptford, name: 'Baby Stay and Play', day: 'Wednesday', start: '13:30', end: '15:00', age: 'Babies aged 0 to 18 months' }),
    staticSession({ ...deptford, name: 'Breastfeeding Hub', day: 'Thursday', start: '10:00', end: '12:00', age: 'Parents and babies', category: 'Feeding & postnatal support' }),
    staticSession({ ...deptford, name: 'Togetherness - Understanding Your Baby Postnatal Group', day: 'Thursday', start: '13:00', end: '15:00', age: 'Parents and babies aged 0 to 10 months', booking: true, startDate: '2026-09-03', endDate: '2026-10-08' }),
    staticSession({ ...deptford, name: 'Introducing Solids', day: 'Thursday', start: '13:00', end: '14:30', age: 'Parents and babies', category: 'Feeding & postnatal support', booking: true, dates: ['2026-10-22'] }),
    staticSession({ ...deptford, name: 'Healthy Families - Right from the Start', day: 'Thursday', start: '13:00', end: '15:00', age: 'Parents and children aged 0 to 5 years', booking: true, startDate: '2026-10-15', endDate: '2026-12-03' }),
    staticSession({ ...deptford, name: 'Fussy Eating Workshop', day: 'Thursday', start: '13:00', end: '14:30', age: 'Parents and young children', booking: true, dates: ['2026-12-10'] }),
    staticSession({ ...deptford, name: 'Explorers Plus with Portage', day: 'Friday', start: '10:00', end: '11:30', age: 'Children from birth to 5 years' }),
    staticSession({ ...deptford, name: 'Dads and Male Carers Stay and Play', day: 'Saturday', start: '10:00', end: '12:00', age: 'Dads, male carers and their children', dates: ['2026-09-19', '2026-11-21'] }),

    staticSession({ ...ladywell, name: 'Togetherness - Understanding Your Child', day: 'Monday', start: '10:00', end: '12:00', age: 'Parents and children aged 1 to 3 years', booking: true, startDate: '2026-09-07', endDate: '2026-11-09' }),
    staticSession({ ...ladywell, name: 'Baby Stay and Play', day: 'Tuesday', start: '10:00', end: '11:30', age: 'Babies aged 0 to 18 months', startDate: '2026-09-08' }),
    staticSession({ ...ladywell, name: 'Stay and Play', day: 'Tuesday', start: '13:15', end: '14:45', age: 'Children aged 0 to 5 years', startDate: '2026-09-08' }),
    staticSession({ ...ladywell, name: 'Baby Massage', day: 'Wednesday', start: '10:00', end: '11:30', age: 'Babies under 1', booking: true, startDate: '2026-09-09', endDate: '2026-10-07' }),
    staticSession({ ...ladywell, name: 'Baby Messy Play', day: 'Thursday', start: '10:00', end: '11:30', age: 'Babies aged 0 to 18 months', category: 'Arts & crafts', startDate: '2026-09-10' }),
    staticSession({ ...ladywell, name: 'Rhythm and Rhyme', day: 'Thursday', start: '13:30', end: '14:30', age: 'Children aged 0 to 5 years', startDate: '2026-09-10' }),
    staticSession({ ...ladywell, name: 'Breastfeeding Hub', day: 'Friday', start: '10:00', end: '12:00', age: 'Parents and babies', category: 'Feeding & postnatal support' }),
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
  const [results, greenwich] = await Promise.all([
    Promise.all(groups.map(async ({ page, parser, provider }) => {
    try {
      const rows = parser(page, await fetchHtml(page.url));
      audit.push({ provider, url: page.url, postcode: normalisePostcode(page.postcode), status: rows.length ? 'ready' : 'empty', sessions: rows.length });
      return rows;
    } catch (error) {
      audit.push({ provider, url: page.url, postcode: normalisePostcode(page.postcode), status: 'failed', sessions: 0, reason: error.message });
      return [];
    }
    })),
    loadGreenwichFamilyDirectorySessions(fetchHtml).catch((error) => ({ rows: [], audit: [], discovered: 0, error })),
  ]);
  audit.push({
    provider: 'Royal Borough of Greenwich Community Directory',
    url: 'https://greenwichcommunitydirectory.org.uk/sitemap.xml',
    status: greenwich.rows.length ? 'ready' : greenwich.error ? 'failed' : 'empty',
    sessions: greenwich.rows.length,
    pages_discovered: greenwich.discovered,
    pages_failed: greenwich.audit.filter((item) => item.status === 'failed').length,
    reason: greenwich.error?.message || undefined,
  });
  return { rows: [...results.flat(), ...greenwich.rows], audit };
}

function sourceUrlFor(session) {
  const identity = [
    normalisePostcode(session.venue_postcode || session.hub_postcode), session.activity_name, session.day,
    session.start_time, session.end_time,
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
    sql(session.cost || 'Free'),
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

  const currentSourceUrls = rows.map(sourceUrlFor);
  return `-- Generated by scripts/import-london-family-hubs.js
-- Replaces generic venue cards with verified named sessions that have exact
-- occurrence dates plus start and end times.
-- Each replacement inherits the generic centre's Published or Draft status;
-- unverifiable generic cards are archived rather than shown as activities.

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
      or archive_reason in (${sql(genericReplacementReason)}, ${sql(publishedGenericReplacementReason)}, ${sql(scheduleGuardArchiveReason)}, ${sql(specificityGuardArchiveReason)})
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

-- Session identity deliberately excludes term dates, so the same listing is
-- refreshed in place each term. Retire rows generated by older identities or
-- sessions no longer present in the current verified timetable.
update public.activities
set archive_previous_listing_status = case
      when public_listing_status in ('published', 'draft') then public_listing_status
      else archive_previous_listing_status
    end,
    public_listing_status = 'archived',
    archive = true,
    archive_reason = 'No longer present in the current verified family-hub timetable.',
    archived_at = coalesce(archived_at, now()),
    updated_at = now()
where source_name = ${sql(sourceName)}
  and coalesce(archive, false) = false
  and (source_url is null or source_url not in (${currentSourceUrls.map(sql).join(', ')}));

-- The insert safety trigger deliberately makes new importer rows Draft. Once
-- a centre has a verified timetable, inherit the status of its generic card.
-- The archive reason remembers a formerly Published centre, which also makes
-- later importer runs and newly-added sessions idempotent.
update public.activities as replacement
set public_listing_status = 'published',
    archive = false,
    updated_at = now()
from public.activities as legacy
join (values
  ${centreMappings.map((mapping) => `(${sql(mapping.legacyPostcode)}, ${sql(mapping.venuePostcode)})`).join(',\n  ')}
) as mapping(legacy_postcode, venue_postcode)
  on mapping.legacy_postcode = upper(regexp_replace(coalesce(legacy.postcode, ''), '\\s+', '', 'g'))
where legacy.source_name = ${sql(legacySourceName)}
  and (
    legacy.public_listing_status = 'published'
    or legacy.archive_previous_listing_status = 'published'
    or legacy.archive_reason = ${sql(publishedGenericReplacementReason)}
  )
  and replacement.source_name = ${sql(sourceName)}
  and coalesce(replacement.archive, false) = false
  and upper(regexp_replace(coalesce(replacement.postcode, ''), '\\s+', '', 'g')) = mapping.venue_postcode
  and replacement.public_listing_status <> 'published';

-- These Published replacements inherited a status that was already reviewed
-- on the generic card, so they should not remain in the pending import queue.
update public.activity_review_queue as review
set status = 'reviewed',
    reviewed_at = coalesce(review.reviewed_at, now())
from public.activities as replacement
where review.activity_id = replacement.activity_id
  and review.status = 'pending'
  and replacement.source_name = ${sql(sourceName)}
  and replacement.public_listing_status = 'published'
  and coalesce(replacement.archive, false) = false;

update public.activities as legacy
set archive_previous_listing_status = case
      when legacy.public_listing_status in ('published', 'draft') then legacy.public_listing_status
      else legacy.archive_previous_listing_status
    end,
    public_listing_status = 'archived',
    archive = true,
    archive_reason = case when exists (
      select 1
      from public.activities replacement
      where replacement.source_name = ${sql(sourceName)}
        and coalesce(replacement.archive, false) = false
        and upper(regexp_replace(coalesce(replacement.postcode, ''), '\\s+', '', 'g')) = upper(regexp_replace(coalesce(legacy.postcode, ''), '\\s+', '', 'g'))
    ) then ${sql(genericReplacementReason)} else ${sql(unverifiableGenericReason)} end,
    archived_at = coalesce(legacy.archived_at, now()),
    updated_at = now()
where legacy.source_name = ${sql(legacySourceName)}
  and coalesce(legacy.archive, false) = false
  and legacy.public_listing_status in ('published', 'draft');
`;
}

async function main() {
  const fixed = [
    ...sessionsForBrent(),
    ...sessionsForCamden(),
    ...sessionsForCroydon(),
    ...sessionsForLambeth(),
    ...sessionsForLewisham(),
    ...sessionsForMerton(),
  ];
  const dynamic = await dynamicSessions();
  const candidates = [...fixed, ...dynamic.rows].map(materialiseFamilyHubSessionDates);
  const validationFailures = [];
  const deduplicated = new Map();
  for (const session of candidates) {
    const errors = validateFamilyHubSession(session);
    if (errors.length) {
      validationFailures.push({ session, errors });
      continue;
    }
    const key = sourceUrlFor(session);
    const existing = deduplicated.get(key);
    deduplicated.set(key, existing ? {
      ...existing,
      available_dates: [...new Set([...(existing.available_dates || []), ...(session.available_dates || [])])].sort(),
    } : session);
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
      generic_cards_without_a_verified_exact_schedule_are_archived: true,
      exact_dates_are_materialised_from_bounded_official_timetables: true,
      replacements_inherit_generic_publication_status: true,
      verified_published_and_draft_generic_cards_are_replaced: true,
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
