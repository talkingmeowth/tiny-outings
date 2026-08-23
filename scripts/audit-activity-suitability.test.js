import test from 'node:test';
import assert from 'node:assert/strict';
import { activitySuitabilityReasons } from './audit-activity-suitability.js';

function googleCafeListing(overrides = {}) {
  return {
    activity_name: 'Fallow',
    category: 'Cafes & food',
    source_name: 'Google Places baby and child friendly cafe importer',
    google_primary_type: 'restaurant',
    description: 'A child-friendly cafe found through Google Places.',
    google_summary: null,
    website: null,
    ...overrides,
  };
}

test('archives a restaurant returned by the cafe importer', () => {
  assert.deepEqual(activitySuitabilityReasons(googleCafeListing()), [
    'Google Places listing is a restaurant or takeaway rather than a cafe',
  ]);
});

test('archives a takeaway returned by the cafe importer', () => {
  const reasons = activitySuitabilityReasons(googleCafeListing({
    activity_name: 'High Street Kebab',
    google_primary_type: 'meal_takeaway',
  }));
  assert.ok(reasons.includes('Google Places listing is a restaurant or takeaway rather than a cafe'));
});

test('keeps a genuine cafe even when Google uses a restaurant type', () => {
  assert.deepEqual(activitySuitabilityReasons(googleCafeListing({
    activity_name: 'The Garden Cafe',
  })), []);
});

test('keeps an explicitly child-focused restaurant activity', () => {
  assert.deepEqual(activitySuitabilityReasons(googleCafeListing({
    activity_name: 'Family story time at The Kitchen',
  })), []);
});

test('archives an explicit greasy-spoon cafe', () => {
  const reasons = activitySuitabilityReasons(googleCafeListing({
    activity_name: 'Workers Cafe',
    google_primary_type: 'cafe',
    google_summary: 'Comfy spot with all-day breakfast, grills and burgers.',
  }));
  assert.ok(reasons.includes('Explicit greasy-spoon cafe is outside the family cafe directory'));
});

test('keeps a family cafe that serves breakfast', () => {
  assert.deepEqual(activitySuitabilityReasons(googleCafeListing({
    activity_name: 'The Little Play Cafe',
    google_primary_type: 'cafe',
    google_summary: 'Baby-friendly play space serving breakfast and cake.',
  })), []);
});
