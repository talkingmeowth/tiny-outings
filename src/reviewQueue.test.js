import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAdminDraftReviewQueue, isActiveDraftActivity } from './reviewQueue.js';

test('admin review queue contains exactly the same active drafts as desktop review', () => {
  const activities = [
    { activity_id: 'draft-b', activity_name: 'Zulu', public_listing_status: 'draft', archive: false },
    { activity_id: 'published', activity_name: 'Published', public_listing_status: 'published', archive: false },
    { activity_id: 'archived-draft', activity_name: 'Archived', public_listing_status: 'draft', archive: true },
    { activity_id: 'draft-a', activity_name: 'Alpha', public_listing_status: 'draft', archive: false },
  ];

  assert.deepEqual(
    buildAdminDraftReviewQueue(activities).map((item) => item.activity_id),
    ['draft-a', 'draft-b'],
  );
  assert.equal(isActiveDraftActivity(activities[0]), true);
  assert.equal(isActiveDraftActivity(activities[1]), false);
  assert.equal(isActiveDraftActivity(activities[2]), false);
});

test('draft queue items retain the complete activity needed for mobile review', () => {
  const activity = {
    activity_id: 'draft-1',
    activity_name: 'Baby music',
    public_listing_status: 'draft',
    archive: false,
    source_name: 'Family hub importer',
  };
  const [item] = buildAdminDraftReviewQueue([activity]);

  assert.equal(item.review_queue_id, 'draft:draft-1');
  assert.equal(item.queue_type, 'draft');
  assert.equal(item.activity, activity);
});
