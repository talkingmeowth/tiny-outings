import test from 'node:test';
import assert from 'node:assert/strict';
import { googlePlaceSearchUrl, isCoordinateOnlyGoogleUrl, isPlausiblePlace, isPlausibleSearchPlace, isStreetOrAddress, nameMatches, needsGoogleSearchFallback } from './google-place-identity.js';

const fenton = {
  activity_name: 'Fenton House', address: 'Hampstead Grove, London NW3 6SP',
  postcode: 'NW3 6SP', lat: 51.559511, long: -0.179381,
  category: 'Museums & culture', data_source: 'Museums London',
  website: 'https://www.nationaltrust.org.uk/visit/london/fenton-house-and-garden',
};
const place = (name, options = {}) => ({
  id: 'ChIJcorrect', displayName: { text: name },
  formattedAddress: 'Hampstead Grove, London NW3 6SP',
  location: { latitude: 51.5589, longitude: -0.1796 },
  ...options,
});

test('Fenton House never accepts the street as its Google place', () => {
  assert.equal(isPlausiblePlace(fenton, place('Hampstead Grove')), false);
  assert.equal(isPlausiblePlace(fenton, place('National Trust - Fenton House and Garden',
    { primaryType: 'historical_landmark' })), true);
});

test('place identity rejects different postcodes and distant locations', () => {
  assert.equal(isPlausiblePlace(fenton, place('Fenton House',
    { formattedAddress: 'Other Road, London NW1 1AA',
      location: { latitude: 51.53, longitude: -0.1796 } })), false);
  assert.equal(isPlausiblePlace(fenton, place('Fenton House',
    { location: { latitude: 51.5, longitude: -0.1796 } })), false);
});

test('a precise nearby venue name survives a neighbouring postcode difference', () => {
  const cafe = { activity_name: 'It Takes a Village Play Cafe',
    address: '152 Billet Road, London E17 5DR', postcode: 'E17 5DR',
    lat: 51.6003, long: -0.0409, data_source: 'Other', category: 'Play cafes' };
  assert.equal(isPlausiblePlace(cafe, place('It Takes a Village Play Cafe', {
    formattedAddress: '152 Billet Road, London E17 5DT',
    location: { latitude: 51.6004, longitude: -0.0409 }, primaryType: 'cafe',
  })), true);
});

test('a renamed museum may match by its official website at the same location', () => {
  const museum = { ...fenton, activity_name: 'V and A Museum of Childhood',
    postcode: 'E2 9PA', address: 'Cambridge Heath Road, London E2 9PA',
    website: 'https://www.vam.ac.uk/young', lat: 51.528, long: -0.055 };
  const renamed = place('Young V&A', {
    formattedAddress: 'Cambridge Heath Road, London E2 9PA',
    location: { latitude: 51.528, longitude: -0.055 },
    websiteUri: 'https://www.vam.ac.uk/young', primaryType: 'museum',
  });
  assert.equal(isPlausiblePlace(museum, renamed), true);
});

test('class listings may point to a named venue but not an address-only result', () => {
  const activity = { activity_name: 'Baby Sensory', address: 'St Mary Church, Main Road, London E1 1AA',
    lat: 51.52, long: -0.07, category: 'Classes & clubs', data_source: 'Happity' };
  const venue = place('St Mary Church', { formattedAddress: 'Main Road, London E1 1AA',
    location: { latitude: 51.52, longitude: -0.07 }, primaryType: 'church' });
  assert.equal(isPlausiblePlace(activity, venue), true);
  assert.equal(isPlausiblePlace(activity, { ...venue, displayName: { text: 'Main Road' }, primaryType: 'route' }), false);
  assert.equal(isPlausiblePlace(activity, { ...venue, displayName: { text: '186 Hoe St' },
    formattedAddress: '186 Hoe St, London E1 1AA', primaryType: 'establishment' }), false);
});

test('name comparisons tolerate accents and punctuation', () => {
  assert.equal(nameMatches({ activity_name: 'Le Delice' }, place('Le Délice')), true);
  assert.equal(nameMatches({ activity_name: 'Fenton House' }, place('Hampstead Grove')), false);
});

test('unverified street pins fall back to a named Maps search', () => {
  assert.equal(isStreetOrAddress(place('Upper Street')), true);
  assert.equal(isStreetOrAddress(place('St Mary Church', { primaryType: 'church' })), false);
  assert.equal(isStreetOrAddress(place('Exmouth Market')), true);
  assert.equal(isStreetOrAddress(place('Exmouth Market', { primaryType: 'market' })), true);
  assert.equal(isStreetOrAddress(place('58-66 George Downing Estate')), true);
  assert.equal(isStreetOrAddress(place('George Downing Estate', { primaryType: 'housing_development' })), true);
  const url = new URL(googlePlaceSearchUrl(fenton));
  assert.equal(url.searchParams.get('query'), 'Fenton House, Hampstead Grove, London NW3 6SP');
});

test('coordinate-only Google links are recognised for named-search replacement', () => {
  assert.equal(isCoordinateOnlyGoogleUrl('https://www.google.com/maps/search/?api=1&query=51.417395%2C-0.082118'), true);
  assert.equal(isCoordinateOnlyGoogleUrl('https://www.google.com/maps/search/?api=1&query=Fenton%20House'), false);
});

test('a named park may cover playgrounds and splash pads within it', () => {
  assert.equal(nameMatches({ activity_name: 'Clissold Park playground, animal enclosures and splash pad',
    category: 'Parks & outdoor play' }, place('Clissold Park', { primaryType: 'park' })), true);
  assert.equal(nameMatches({ activity_name: 'The Highams Park playground',
    category: 'Parks & outdoor play' }, place('Highams Park', { primaryType: 'transit_station' })), false);
});

test('generic connective words cannot turn a different centre into a match', () => {
  const activity = { activity_name: 'Stay and Play', address: '35 Burgoyne Road, London SW9 9QJ',
    postcode: 'SW9 9QJ', lat: 51.466723, long: -0.118183, category: 'Stay & play' };
  assert.equal(isPlausiblePlace(activity, place("Stockwell Primary School and Children's Centre", {
    formattedAddress: 'Stockwell Rd, London SW9 9TG',
    location: { latitude: 51.47, longitude: -0.12 }, primaryType: 'school',
  })), false);
});

test('an event provider at a different departure location is not the event place', () => {
  const activity = { activity_name: 'Paddington Afternoon Tea Tour',
    address: '8 Northumberland Ave, London WC2N 5BY', postcode: 'WC2N 5BY',
    lat: 51.506982, long: -0.125999, category: 'Events' };
  assert.equal(isPlausiblePlace(activity, place("Brigit's Bakery & Afternoon Tea Bus Tours", {
    formattedAddress: '6-7 Chandos Pl, London WC2N 4HU',
    location: { latitude: 51.509, longitude: -0.125 }, primaryType: 'bakery',
  })), false);
});

test('an unverified direct pin becomes a named Maps search, not a claimed Place', () => {
  assert.equal(needsGoogleSearchFallback({ ...fenton, google_place_id: 'old' }, place('Hampstead Grove'), 'unresolved'), true);
  assert.equal(needsGoogleSearchFallback({ ...fenton, google_place_id: 'old' }, place('Different named venue'), 'unresolved'), true);
  assert.equal(needsGoogleSearchFallback({ google_place_id: null }, null, 'unresolved'), false);
  assert.equal(needsGoogleSearchFallback({ google_place_id: 'old' }, null, 'request-error'), false);
  assert.equal(needsGoogleSearchFallback({ google_place_id: 'old' }, place('Fenton House'), 'update'), false);
});

test('a class or show may link to its actual venue at the exact street address', () => {
  const classActivity = { activity_name: 'DOREMEEBIES', address: '82 Winchester Rd, London E4 9JP',
    lat: 51.603816, long: -0.003068, category: 'Classes & clubs', data_source: 'Happity' };
  const church = place('Winchester Road Methodist Church', {
    formattedAddress: '82 Winchester Rd, London E4 9JP',
    location: { latitude: 51.60382, longitude: -0.00306 }, primaryType: 'church',
  });
  assert.equal(isPlausiblePlace(classActivity, church), true);
  const show = { activity_name: 'The Lion King', address: '21 Wellington St, London WC2E 7RQ',
    lat: 51.51154, long: -0.120081, category: 'Events', data_source: 'Fever' };
  assert.equal(isPlausiblePlace(show, place("Lyceum Theatre", {
    formattedAddress: '21 Wellington St, London WC2E 7RQ',
    location: { latitude: 51.51154, longitude: -0.12008 }, primaryType: 'theater',
  })), true);
  assert.equal(isPlausiblePlace(classActivity, { ...church,
    formattedAddress: '86 Winchester Rd, London E4 9JP',
  }), false);
  assert.equal(isPlausiblePlace({ ...classActivity,
    address: 'St Mary Church, 82 Winchester Rd, London E4 9JP',
  }, place('St John Church', {
    formattedAddress: 'St John Church, 82 Other Rd, London E4 9JP',
    location: { latitude: 51.60382, longitude: -0.00306 }, primaryType: 'church',
  })), false);
});

test('a library activity may use a verified library pin at the same abbreviated address', () => {
  const activity = { activity_name: 'Kids Crafts at North Chingford Library Saturday',
    address: 'The Grn, London E4 7EN', lat: 51.631509, long: 0.002854,
    category: 'Classes & clubs' };
  assert.equal(isPlausiblePlace(activity, place('Chingford Library', {
    formattedAddress: 'The Grn, London E4 7EN',
    location: { latitude: 51.631509, longitude: 0.002854 }, primaryType: 'library',
  })), true);
});

test('a long, distinctive provider name can prefix its class title', () => {
  const activity = { activity_name: 'JUNIORSTRIKERS LTD BABY STRIKERS FOOTBALL',
    address: 'London E9 7DD', lat: 51.536798, long: -0.038635,
    category: 'Parks & outdoor play' };
  assert.equal(isPlausiblePlace(activity, place('Juniorstrikers Ltd', {
    formattedAddress: '89 Wetherell Rd, London E9 7DA',
    location: { latitude: 51.537, longitude: -0.039 }, primaryType: 'sports_school',
  })), true);
  assert.equal(isPlausiblePlace({ ...activity,
    activity_name: 'Juniorstrikers Baby Strikers Football',
  }, place('Juniorstrikers Ltd', {
    formattedAddress: '89 Wetherell Rd, London E9 7DA',
    location: { latitude: 51.537, longitude: -0.039 }, primaryType: 'sports_school',
  })), true);
});

test('text search will not assign a nearby unrelated landmark to a football class', () => {
  const activity = { activity_name: 'FOXES CLUB FOOTBALL 3 4 YEARS',
    address: 'Heath Lodge, London NW5 1QR', lat: 51.56, long: -0.15,
    category: 'Classes & clubs' };
  const viewpoint = place('Parliament Hill Viewpoint', {
    formattedAddress: 'Heath Lodge, London NW5 1QR',
    location: { latitude: 51.56, longitude: -0.15 }, primaryType: 'tourist_attraction',
  });
  assert.equal(isPlausiblePlace(activity, viewpoint), true);
  assert.equal(isPlausibleSearchPlace(activity, viewpoint), false);
});

test('official museum site and exact postcode can overcome an inaccurate stored coordinate', () => {
  const activity = { activity_name: 'V and A', address: 'Cromwell Rd, London',
    postcode: 'SW7 2RL', lat: 51.494903, long: -0.184590,
    category: 'Museums & culture', website: 'http://www.vam.ac.uk' };
  assert.equal(isPlausiblePlace(activity, place('Victoria and Albert Museum', {
    formattedAddress: 'Cromwell Rd, London SW7 2RL',
    location: { latitude: 51.4966392, longitude: -0.17218 },
    websiteUri: 'https://www.vam.ac.uk/south-kensington', primaryType: 'art_museum',
  })), true);
});
