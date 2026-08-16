import assert from 'node:assert/strict';
import test from 'node:test';
import { dedupePublishedActivities, findLikelyDuplicate } from './activityDuplicates.js';

const published = (overrides = {}) => ({
  public_listing_status: 'published',
  archive: false,
  activity_name: 'Baby sensory at the Natural History Museum',
  address: 'Cromwell Road, London SW7 5BD',
  borough: 'Kensington and Chelsea',
  ...overrides,
});

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
  });
  const richer = published({
    activity_id: 'richer',
    google_place_id: 'place-123',
    description: 'A full activity description.',
    website: 'https://example.test',
    scraped_image_url: 'https://images.example.test/activity.jpg',
  });

  assert.deepEqual(dedupePublishedActivities([basic, richer]), [richer]);
});

test('dedupe keeps similarly named activities at different venues', () => {
  const first = published({ activity_id: 'first' });
  const second = published({
    activity_id: 'second',
    address: 'Mare Street, London E8 1EA',
    borough: 'Hackney',
  });

  assert.deepEqual(dedupePublishedActivities([first, second]), [first, second]);
});

test('dedupe keeps distinct activities that share an organiser or venue link', () => {
  const swim = published({
    activity_id: 'swim',
    activity_name: 'Baby swim',
    website: 'https://provider.example.test',
    google_place_uri: 'https://maps.google.test/venue',
  });
  const sensory = published({
    activity_id: 'sensory',
    activity_name: 'Baby sensory',
    website: 'https://provider.example.test',
    google_place_uri: 'https://maps.google.test/venue',
  });

  assert.deepEqual(dedupePublishedActivities([swim, sensory]), [swim, sensory]);
});
