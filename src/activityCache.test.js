import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVITY_CACHE_MAX_AGE_MS,
  activitiesFromCacheSnapshot,
  createActivityCacheSnapshot,
  readActivityDirectoryCache,
  writeActivityDirectoryCache,
} from './activityCache.js';

const published = { activity_id: 'public', public_listing_status: 'published', archive: false, activity_name: 'Music class' };

test('cache stores published cards and image choices but never drafts, archives, private notes or candidate payloads', () => {
  const snapshot = createActivityCacheSnapshot([
    { ...published, user_uploaded_image_url: 'https://example.com/photo.jpg',
      use_category_image: true, submitted_by_user_id: 'private', submission_notes: 'private',
      serpapi_image_candidates: [{ original: 'not needed' }] },
    { ...published, activity_id: 'draft', public_listing_status: 'draft' },
    { ...published, activity_id: 'archived', archive: true },
  ], 1000);
  assert.deepEqual(activitiesFromCacheSnapshot(snapshot, 1001), [{
    ...published, user_uploaded_image_url: 'https://example.com/photo.jpg', use_category_image: true,
  }]);
});

test('expired, incompatible and corrupt snapshots are ignored; a confirmed empty directory is valid', () => {
  const snapshot = createActivityCacheSnapshot([published], 1000);
  assert.equal(activitiesFromCacheSnapshot(snapshot, 1001 + ACTIVITY_CACHE_MAX_AGE_MS), null);
  assert.equal(activitiesFromCacheSnapshot({ ...snapshot, version: -1 }, 1001), null);
  assert.equal(activitiesFromCacheSnapshot({ ...snapshot, savedAt: 2000 }, 1001), null);
  assert.equal(activitiesFromCacheSnapshot({ ...snapshot, activities: [null] }, 1001), null);
  assert.equal(activitiesFromCacheSnapshot(null), null);
  assert.deepEqual(activitiesFromCacheSnapshot(createActivityCacheSnapshot([], 1000), 1001), []);
});

test('cache reads recheck publication so a malformed snapshot cannot expose draft data', () => {
  const snapshot = createActivityCacheSnapshot([published], 1000);
  snapshot.activities.push({ ...published, public_listing_status: 'draft' });
  assert.deepEqual(activitiesFromCacheSnapshot(snapshot, 1001), [published]);
});

test('unavailable browser storage never prevents startup or refresh', async () => {
  assert.equal(await readActivityDirectoryCache(), null);
  await assert.doesNotReject(() => writeActivityDirectoryCache([published]));
});
