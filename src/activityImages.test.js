import assert from 'node:assert/strict';
import test from 'node:test';
import { shareListingImages } from './activityImages.js';
import { activityImageUrls } from './activityImages.js';

function activity(overrides = {}) {
  return {
    activity_id: crypto.randomUUID(),
    activity_name: 'Tiny swimmers',
    address: '1 Pool Road, London E10 1AA',
    start_time: '10:00',
    end_time: '10:30',
    ...overrides,
  };
}

test('uses one admin cover image across the same listing at different times', () => {
  const morning = activity({
    activity_id: 'morning',
    start_time: '10:00',
    scraped_image_url: 'https://images.example.test/morning.jpg',
  });
  const afternoon = activity({
    activity_id: 'afternoon',
    start_time: '14:00',
    admin_cover_image_url: 'https://images.example.test/admin-cover.jpg',
  });

  const [sharedMorning, sharedAfternoon] = shareListingImages([morning, afternoon]);
  assert.equal(sharedMorning.shared_card_image_url, 'https://images.example.test/admin-cover.jpg');
  assert.equal(sharedAfternoon.shared_card_image_url, 'https://images.example.test/admin-cover.jpg');
  assert.equal(sharedMorning.shared_card_image_source, 'admin_cover_image_url');
});

test('does not share an image between similarly named activities at different venues', () => {
  const first = activity({ scraped_image_url: 'https://images.example.test/first.jpg' });
  const second = activity({
    address: '2 Pool Road, London E8 1AA',
    scraped_image_url: 'https://images.example.test/second.jpg',
  });

  const [sharedFirst, sharedSecond] = shareListingImages([first, second]);
  assert.equal(sharedFirst.shared_card_image_url, 'https://images.example.test/first.jpg');
  assert.equal(sharedSecond.shared_card_image_url, 'https://images.example.test/second.jpg');
});

test('uses a legacy image URL only after every curated image field is absent', () => {
  const item = activity({ image_url: 'https://images.example.test/legacy.jpg' });
  assert.deepEqual(activityImageUrls(item), ['https://images.example.test/legacy.jpg']);
});

test('only allows Wikimedia images for parks, museums, and family activities', () => {
  const wikimedia = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/venue.jpg';
  for (const category of ['Parks & outdoor play', 'Museums & culture', 'Family activities']) {
    assert.deepEqual(activityImageUrls(activity({ category, wikimedia_image_url: wikimedia })), [wikimedia]);
  }

  const cafe = activity({
    category: 'Cafes & food',
    wikimedia_image_url: wikimedia,
    website_image_url: 'https://cafe.example/interior.jpg',
  });
  assert.deepEqual(activityImageUrls(cafe), ['https://cafe.example/interior.jpg']);
});

test('rejects managed SerpAPI copies whose source is Wikimedia in a disallowed category', () => {
  const cafe = activity({
    category: 'Cafes & food',
    scraped_image_url: 'https://storage.example/activity-images/selected.jpg',
    image_source_url: 'https://commons.wikimedia.org/wiki/File:Cafe.jpg',
  });
  assert.deepEqual(activityImageUrls(cafe), []);
});
