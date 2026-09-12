import assert from 'node:assert/strict';
import test from 'node:test';
import { imageSourceConflict } from './image-source-provenance.js';

const activity = {
  activity_name: 'Abbotts Park Play Area',
  address: 'Abbotts Park Road, London E10 6HX',
  borough: 'Waltham Forest',
  website: 'https://www.walthamforest.gov.uk/abbotts-park',
};

test('flags an image result that clearly names an unrelated overseas source', () => {
  const result = imageSourceConflict(activity, {
    source_page_url: 'https://chicagoplaygrounds.com/abbott-park',
    source_domain: 'chicagoplaygrounds.com',
    title: 'Abbott Park playground - Chicago Playgrounds',
  });
  assert.equal(result.clear, true);
  assert.equal(result.location_conflict, true);
  assert.ok(result.score >= 0.8);
});

test('flags a conflicting postcode even when the category is plausible', () => {
  const result = imageSourceConflict(activity, {
    source_page_url: 'https://example.org/playgrounds/example',
    title: 'Family playground, Bristol BS1 4ST',
  });
  assert.equal(result.clear, true);
  assert.equal(result.postcode_conflict, true);
});

test('does not penalise the activity official website', () => {
  const result = imageSourceConflict(activity, {
    source_page_url: 'https://www.walthamforest.gov.uk/abbotts-park/gallery',
    title: 'Abbotts Park play area',
  });
  assert.equal(result.score, 0);
  assert.equal(result.official, true);
});

test('does not call a neutral directory result a clear conflict', () => {
  const result = imageSourceConflict(activity, {
    source_page_url: 'https://tripadvisor.co.uk/Attraction_Review-example',
    title: 'Abbotts Park Play Area, London',
  });
  assert.equal(result.clear, false);
  assert.equal(result.brand_conflict, false);
});
