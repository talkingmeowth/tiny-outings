import assert from 'node:assert/strict';
import test from 'node:test';
import { isFamilyCafePlace, officialWebsiteUrl, parkExternalFields } from './activity-import-policy.js';

test('only accepts an activity own website, never a Google or Maps fallback', () => {
  assert.equal(officialWebsiteUrl('https://maps.google.com/?q=Tiny+Outings'), null);
  assert.equal(officialWebsiteUrl('https://maps.app.goo.gl/example'), null);
  assert.equal(officialWebsiteUrl('not a URL'), null);
  assert.equal(officialWebsiteUrl('https://www.example.org/visit'), 'https://www.example.org/visit');
});

test('keeps permanently closed, adult-focused, and manually excluded cafes out of imports', () => {
  assert.equal(isFamilyCafePlace({ businessStatus: 'CLOSED_PERMANENTLY' }), false);
  assert.equal(isFamilyCafePlace({ primaryType: 'pub', displayName: { text: 'A pub' } }), false);
  assert.equal(isFamilyCafePlace({ primaryType: 'cafe', displayName: { text: 'Elite Cafe' } }), false);
  assert.equal(isFamilyCafePlace({ primaryType: 'cafe', displayName: { text: 'Friendly Cafe' } }), true);
});

test('keeps park records deliberately free of generic external links', () => {
  assert.deepEqual(parkExternalFields, {
    website: null,
    organiser_website: null,
    image_url: null,
    image_source_url: null,
  });
});
