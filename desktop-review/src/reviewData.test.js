import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activitiesForQueue,
  activitiesToPreload,
  currentImage,
  prepareActivities,
  preparedActivitiesForQueue,
  queueCounts,
  queueCountsFromPrepared,
  searchQueries,
} from './reviewData.js';

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

test('builds the five live queue counts and resolves reviewed unsuitable images', () => {
  const activities = [
    listing({ activity_id: 'missing' }),
    listing({ activity_id: 'audited', address: 'Hackney, London E8', audit_image_status: 'needs_replacement', website_image_url: 'https://bad.test/photo.jpg' }),
    listing({ activity_id: 'resolved', address: 'Camden, London NW1', audit_image_status: 'needs_replacement', reviewed_image_url: 'https://good.test/photo.jpg' }),
    listing({ activity_id: 'draft', address: 'Islington, London N1', public_listing_status: 'draft' }),
    listing({ activity_id: 'ignored', image_review_ignored_at: '2026-08-25T18:00:00Z' }),
  ];
  assert.deepEqual(queueCounts(activities), {
    missing_published: 1,
    unsuitable_audit: 1,
    all_published: 3,
    all_draft: 1,
    ignored: 1,
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

test('reuses one prepared listing set for queue counts and queue contents', () => {
  const activities = [
    listing({ activity_id: 'missing' }),
    listing({ activity_id: 'pictured', website_image_url: 'https://venue.test/activity.jpg' }),
    listing({ activity_id: 'draft', public_listing_status: 'draft' }),
  ];
  const prepared = prepareActivities(activities);
  assert.deepEqual(queueCountsFromPrepared(prepared), queueCounts(activities));
  assert.deepEqual(
    preparedActivitiesForQueue(prepared, 'missing_published').map((activity) => activity.activity_id),
    activitiesForQueue(activities, 'missing_published').map((activity) => activity.activity_id),
  );
});

test('ignored listings only appear in the ignored queue', () => {
  const ignored = listing({ activity_id: 'ignored', audit_image_status: 'needs_replacement', image_review_ignored_at: '2026-08-25T18:00:00Z' });
  assert.equal(activitiesForQueue([ignored], 'missing_published').length, 0);
  assert.equal(activitiesForQueue([ignored], 'unsuitable_audit').length, 0);
  assert.equal(activitiesForQueue([ignored], 'all_published').length, 0);
  assert.deepEqual(activitiesForQueue([ignored], 'ignored').map((activity) => activity.activity_id), ['ignored']);
});

test('interleaves and deduplicates candidate preload targets across active queues', () => {
  const activities = prepareActivities([
    listing({ activity_id: 'missing', address: '1 Missing Road, London' }),
    listing({ activity_id: 'unsuitable', address: '2 Unsuitable Road, London', audit_image_status: 'needs_replacement', website_image_url: 'https://bad.test/photo.jpg' }),
    listing({ activity_id: 'published', address: '3 Published Road, London', website_image_url: 'https://good.test/photo.jpg' }),
    listing({ activity_id: 'draft', address: '4 Draft Road, London', public_listing_status: 'draft' }),
    listing({ activity_id: 'ignored', address: '5 Ignored Road, London', image_review_ignored_at: '2026-08-25T18:00:00Z' }),
  ]);
  assert.deepEqual(
    activitiesToPreload(activities, ['missing_published', 'unsuitable_audit', 'all_published', 'all_draft']).map((activity) => activity.activity_id),
    ['missing', 'unsuitable', 'draft', 'published'],
  );
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
