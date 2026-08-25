import assert from 'node:assert/strict';
import test from 'node:test';
import { activitiesForQueue, currentImage, queueCounts, searchQueries } from './reviewData.js';

function listing(overrides = {}) {
  return {
    activity_id: crypto.randomUUID(),
    activity_name: 'Baby Sensory Leyton',
    address: 'Leyton, London E10 5AB',
    borough: 'Waltham Forest',
    category: 'Baby & toddler classes',
    public_listing_status: 'published',
    archive: false,
    ...overrides,
  };
}

test('builds the four live queue counts and resolves reviewed unsuitable images', () => {
  const activities = [
    listing({ activity_id: 'missing' }),
    listing({ activity_id: 'audited', address: 'Hackney, London E8', audit_image_status: 'needs_replacement', website_image_url: 'https://bad.test/photo.jpg' }),
    listing({ activity_id: 'resolved', address: 'Camden, London NW1', audit_image_status: 'needs_replacement', reviewed_image_url: 'https://good.test/photo.jpg' }),
    listing({ activity_id: 'draft', address: 'Islington, London N1', public_listing_status: 'draft' }),
  ];
  assert.deepEqual(queueCounts(activities), {
    missing_published: 1,
    unsuitable_audit: 1,
    all_published: 3,
    all_draft: 1,
  });
  assert.deepEqual(activitiesForQueue(activities, 'unsuitable_audit').map((item) => item.activity_id), ['audited']);
});

test('does not count a recurring sibling as missing when its shared listing has an image', () => {
  const activities = [
    listing({ activity_id: 'morning', start_time: '09:00' }),
    listing({ activity_id: 'afternoon', start_time: '14:00', website_image_url: 'https://venue.test/activity.jpg' }),
  ];
  assert.equal(activitiesForQueue(activities, 'missing_published').length, 0);
});

test('does not duplicate a locality already in an activity name', () => {
  assert.equal(searchQueries(listing()).activity_location, 'Baby Sensory Leyton');
});

test('builds provider and activity-only alternatives', () => {
  const queries = searchQueries(listing({
    activity_name: 'Saturday singalong',
    organiser_website: 'https://mini-mozart.co.uk/classes',
    address: 'Hackney, London',
  }));
  assert.equal(queries.provider_location, 'Mini Mozart Hackney');
  assert.equal(queries.activity_only, 'Saturday singalong');
});

test('manual desktop review sits below admin cover and above user image', () => {
  const reviewed = listing({
    reviewed_image_url: 'https://storage.test/reviewed.jpg',
    reviewed_image_source_url: 'https://venue.test/gallery',
    user_image_url: 'https://storage.test/admin-url.jpg',
  });
  assert.deepEqual(currentImage(reviewed), {
    url: 'https://storage.test/reviewed.jpg',
    field: 'reviewed_image_url',
    label: 'Desktop review',
    sourceUrl: 'https://venue.test/gallery',
    sourceDomain: 'venue.test',
  });
  assert.equal(currentImage({ ...reviewed, admin_cover_image_url: 'https://storage.test/admin.jpg' }).field, 'admin_cover_image_url');
});
