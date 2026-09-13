import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activityImageFamilyKey,
  dedupePublishedActivities,
  findLikelyDuplicate,
} from './activityDuplicates.js';

const published = (overrides = {}) => ({
  public_listing_status: 'published',
  archive: false,
  activity_name: 'Baby sensory at the Natural History Museum',
  address: 'Cromwell Road, London SW7 5BD',
  borough: 'Kensington and Chelsea',
  ...overrides,
});

function activity(overrides = {}) {
  return {
    activity_id: crypto.randomUUID(),
    activity_name: 'Baby music',
    address: '1 Test Street, London E10 1AA',
    public_listing_status: 'published',
    archive: false,
    ...overrides,
  };
}

test('matches a submitted link to the same canonical listing URL', () => {
  const candidate = published({ website: 'https://www.nhm.ac.uk/events/adventure-babies.html' });
  const match = findLikelyDuplicate({ source_url: 'https://www.nhm.ac.uk/events/adventure-babies.html?utm_source=parent' }, [candidate]);
  assert.equal(match?.activity, candidate);
  assert.equal(match?.score, 1);
});

test('matches the same activity when title and address strongly agree', () => {
  const candidate = published();
  const match = findLikelyDuplicate(published({ website: 'https://example.test/new-link' }), [candidate]);
  assert.equal(match?.activity, candidate);
  assert.ok(match?.score >= 0.9);
});

test('does not flag a similar activity at a different venue', () => {
  const candidate = published({ address: 'Hackney Town Hall, Mare Street, London E8 1EA', borough: 'Hackney' });
  const submission = published({ address: 'Cromwell Road, London SW7 5BD', borough: 'Kensington and Chelsea' });
  assert.equal(findLikelyDuplicate(submission, [candidate]), null);
});

test('dedupes matching Google Places records and keeps the more complete card', () => {
  const basic = published({
    activity_id: 'basic',
    google_place_id: 'place-123',
    description: null,
    website: null,
    start_time: '10:00',
    end_time: '10:45',
  });
  const richer = published({
    activity_id: 'richer',
    google_place_id: 'place-123',
    description: 'A full activity description.',
    website: 'https://example.test',
    scraped_image_url: 'https://images.example.test/activity.jpg',
    start_time: '10:00',
    end_time: '10:45',
  });

  assert.deepEqual(dedupePublishedActivities([basic, richer]), [richer]);
});

test('dedupe keeps similarly named activities at different venues', () => {
  const first = published({ activity_id: 'first', start_time: '10:00', end_time: '10:45' });
  const second = published({
    activity_id: 'second',
    address: 'Mare Street, London E8 1EA',
    borough: 'Hackney',
    start_time: '10:00',
    end_time: '10:45',
  });

  assert.deepEqual(dedupePublishedActivities([first, second]), [first, second]);
});

test('dedupe keeps distinct activities that share an organiser or venue link', () => {
  const swim = published({
    activity_id: 'swim',
    activity_name: 'Baby swim',
    website: 'https://provider.example.test',
    google_place_uri: 'https://maps.google.test/venue',
    start_time: '10:00',
    end_time: '10:45',
  });
  const sensory = published({
    activity_id: 'sensory',
    activity_name: 'Baby sensory',
    website: 'https://provider.example.test',
    google_place_uri: 'https://maps.google.test/venue',
    start_time: '10:00',
    end_time: '10:45',
  });

  assert.deepEqual(dedupePublishedActivities([swim, sensory]), [swim, sensory]);
});

test('keeps recurring sessions at the same venue when their time differs', () => {
  const records = [
    activity({ source_url: 'https://www.happity.co.uk/schedules/baby-music#mon-1000', days_of_week: ['Monday'], start_time: '10:00', end_time: '10:45' }),
    activity({ source_url: 'https://www.happity.co.uk/schedules/baby-music#tue-1100', days_of_week: ['Tuesday'], start_time: '11:00', end_time: '11:45' }),
  ];

  assert.equal(dedupePublishedActivities(records).length, 2);
});

test('collapses genuinely matching cross-source listings', () => {
  const records = [
    activity({ source_url: 'https://example.com/listing-one', days_of_week: ['Monday'], start_time: '10:00', end_time: '10:45', description: 'Short description' }),
    activity({ source_url: 'https://another.example/listing-two', days_of_week: ['Monday'], start_time: '10:00', end_time: '10:45', description: 'A fuller description', website: 'https://example.org' }),
  ];

  const result = dedupePublishedActivities(records);
  assert.equal(result.length, 1);
  assert.equal(result[0].description, 'A fuller description');
});

test('groups official Baby Sensory branches but not unrelated sensory activities', () => {
  const woolwich = activity({
    activity_name: 'Baby Sensory Woolwich-Greenwich',
    address: 'Woolwich, London SE18 6HQ',
    organiser_website: 'https://www.babysensory.com/greenwich/',
  });
  const dulwich = activity({
    activity_name: 'Dulwich Baby Sensory',
    address: 'Dulwich, London SE21 7LD',
    website: 'https://www.babysensory.com/dulwich/',
  });
  const unrelated = activity({
    activity_name: 'Quaggy Baby Sensory Stay and Play',
    address: 'Greenwich, London SE10',
    website: 'https://www.royalgreenwich.gov.uk/community-directory/quaggy',
  });

  assert.equal(activityImageFamilyKey(woolwich), 'family:baby-sensory');
  assert.equal(activityImageFamilyKey(dulwich), 'family:baby-sensory');
  assert.notEqual(activityImageFamilyKey(unrelated), 'family:baby-sensory');
});

test('keeps Baby Sensory and Toddler Sense as separate image families', () => {
  assert.equal(activityImageFamilyKey(activity({
    activity_name: 'Baby Sensory Enfield',
    organiser_website: 'https://www.babysensory.com/enfield/',
  })), 'family:baby-sensory');
  assert.equal(activityImageFamilyKey(activity({
    activity_name: 'Toddler Sense Enfield',
    organiser_website: 'https://www.babysensory.com/enfield/toddler-sense',
  })), 'family:toddler-sense');
});

test('normalises road abbreviations when the same official activity name includes its location', () => {
  const greatRussellStreet = activity({
    activity_name: "GAIL's Bakery Great Russell Street",
    address: '58 Great Russell St, London WC1B 3BA',
    website: 'https://gailsbread.co.uk/bakeries/great-russell-street/',
  });
  const archway = activity({
    activity_name: "GAIL's Bakery Archway",
    address: 'Archway, London N19 5RQ',
    website: 'https://gailsbread.co.uk/bakeries/archway/',
  });
  assert.equal(activityImageFamilyKey(greatRussellStreet), 'provider:gailsbread.co.uk|gail bakery');
  assert.equal(activityImageFamilyKey(archway), 'provider:gailsbread.co.uk|gail bakery');
});

test('keeps Mini Mozart Baby and Toddler classes in separate provider families', () => {
  const baby = activity({
    activity_name: 'MINI MOZART BABY CLASS',
    organiser_website: 'https://www.minimozart.com/',
  });
  const toddler = activity({
    activity_name: 'MINI MOZART TODDLER CLASS',
    organiser_website: 'https://minimozart.com/',
  });
  assert.equal(activityImageFamilyKey(baby), 'family:mini-mozart-baby');
  assert.equal(activityImageFamilyKey(toddler), 'family:mini-mozart-toddler');
});

test('keeps Monkey Music class types separate while sharing each class across locations', () => {
  const provider = 'https://www.monkeymusic.co.uk/';
  assert.equal(activityImageFamilyKey(activity({ activity_name: 'MONKEY MUSIC DING DONG', organiser_website: provider })), 'family:monkey-music-ding-dong');
  assert.equal(activityImageFamilyKey(activity({ activity_name: 'Monkey Music Heigh Ho', organiser_website: provider })), 'family:monkey-music-heigh-ho');
  assert.equal(activityImageFamilyKey(activity({ activity_name: 'MONKEY MUSIC JIGGETY JIG', organiser_website: provider })), 'family:monkey-music-jiggety-jig');
  assert.equal(activityImageFamilyKey(activity({ activity_name: "Monkey Music Rock n Roll", organiser_website: provider })), 'family:monkey-music-rock-n-roll');
});
