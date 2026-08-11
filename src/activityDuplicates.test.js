import assert from 'node:assert/strict';
import test from 'node:test';
import { findLikelyDuplicate } from './activityDuplicates.js';

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
