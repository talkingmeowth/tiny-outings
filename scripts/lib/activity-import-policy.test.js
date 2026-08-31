import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isFamilyCafePlace,
  isGenericGovernmentActivityUrl,
  officialWebsiteUrl,
  parkExternalFields,
} from './activity-import-policy.js';

test('only accepts an activity own website, never a Google or Maps fallback', () => {
  assert.equal(officialWebsiteUrl('https://maps.google.com/?q=Tiny+Outings'), null);
  assert.equal(officialWebsiteUrl('https://maps.app.goo.gl/example'), null);
  assert.equal(officialWebsiteUrl('not a URL'), null);
  assert.equal(officialWebsiteUrl('https://www.example.org/visit'), 'https://www.example.org/visit');
});

test('rejects generic government destinations but keeps specific official activity pages', () => {
  assert.equal(isGenericGovernmentActivityUrl('https://www.gov.uk/government/publications/list-of-family-hub-sites'), true);
  assert.equal(isGenericGovernmentActivityUrl('https://www.walthamforest.gov.uk/'), true);
  assert.equal(isGenericGovernmentActivityUrl('https://www.newham.gov.uk/homepage/126/find-your-local-park'), true);
  assert.equal(isGenericGovernmentActivityUrl('https://families.camden.gov.uk/full-stay-play-timetable/'), false);
  assert.equal(isGenericGovernmentActivityUrl('https://www.walthamforest.gov.uk/events/stay-and-play-low-hall-nursery-school'), false);
  assert.equal(isGenericGovernmentActivityUrl('https://hackney.gov.uk/st-johns-churchyard'), false);
  assert.equal(officialWebsiteUrl('https://www.walthamforest.gov.uk/libraries'), null);
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
