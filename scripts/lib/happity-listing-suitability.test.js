import assert from 'node:assert/strict';
import test from 'node:test';
import { happityListingExclusionReasons, isExcludedHappityListing } from './happity-listing-suitability.js';

test('excludes Happity activities that are explicitly religious', () => {
  const reasons = happityListingExclusionReasons({
    activityName: 'Messy Church toddler group',
    description: 'Songs, crafts and Bible stories for little ones.',
  });
  assert.deepEqual(reasons, ['Explicitly religious Happity activity']);
});

test('excludes Happity activities that explicitly teach a language', () => {
  assert.equal(isExcludedHappityListing({
    activityName: '123 Greek English playgroup',
    description: 'Learn Greek through songs and sensory play.',
  }), true);
});

test('keeps a general activity at a church venue', () => {
  assert.equal(isExcludedHappityListing({
    activityName: 'Baby sensory and messy play',
    description: 'A weekly class held at St Mary Church hall.',
  }), false);
});

test('keeps non-language activities with ordinary cultural words', () => {
  assert.equal(isExcludedHappityListing({
    activityName: 'Mini Latin dance',
    description: 'A joyful dance class for ages three to five.',
  }), false);
});
