import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activitiesForQueue,
  activitiesToPreload,
  currentImage,
  displayedImageSource,
  googlePlacesUrl,
  imageSourceOptions,
  prepareActivities,
  preparedActivitiesForQueue,
  preloadReadinessByQueue,
  queueCounts,
  queueCountsFromPrepared,
  searchQueries,
  storedImageCandidates,
  storedSourceFieldForSelection,
  storedSourceSelectionKey,
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

test('builds the five requested queue counts', () => {
  const activities = [
    listing({ activity_id: 'missing', address: 'Leyton, London E10' }),
    listing({ activity_id: 'audited', address: 'Hackney, London E8', audit_image_status: 'needs_replacement', website_image_url: 'https://bad.test/photo.jpg' }),
    listing({ activity_id: 'resolved', address: 'Camden, London NW1', audit_image_status: 'needs_replacement', reviewed_image_url: 'https://good.test/photo.jpg' }),
    listing({ activity_id: 'draft', address: 'Islington, London N1', public_listing_status: 'draft' }),
    listing({ activity_id: 'ignored', address: 'Stratford, London E15', image_review_ignored_at: '2026-08-25T18:00:00Z' }),
    listing({ activity_id: 'automated', address: 'Walthamstow, London E17', model_selected_url: 'https://model.test/photo.jpg', automated_image_review: { status: 'pending', candidate_index: 2 } }),
  ];
  assert.deepEqual(queueCounts(activities), {
    all_activities: 6,
    model_selected: 1,
    all_published: 5,
    all_draft: 1,
    missing_images: 3,
  });
});

test('does not count a recurring sibling as missing when its shared listing has an image', () => {
  const activities = [
    listing({ activity_id: 'morning', start_time: '09:00' }),
    listing({ activity_id: 'afternoon', start_time: '14:00', website_image_url: 'https://venue.test/activity.jpg' }),
  ];
  assert.equal(activitiesForQueue(activities, 'missing_images').length, 0);
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
    preparedActivitiesForQueue(prepared, 'missing_images').map((activity) => activity.activity_id),
    activitiesForQueue(activities, 'missing_images').map((activity) => activity.activity_id),
  );
});

test('ignored listings remain visible in the all and status queues', () => {
  const ignored = listing({ activity_id: 'ignored', audit_image_status: 'needs_replacement', image_review_ignored_at: '2026-08-25T18:00:00Z' });
  assert.deepEqual(activitiesForQueue([ignored], 'all_activities').map((activity) => activity.activity_id), ['ignored']);
  assert.deepEqual(activitiesForQueue([ignored], 'all_published').map((activity) => activity.activity_id), ['ignored']);
  assert.deepEqual(activitiesForQueue([ignored], 'missing_images').map((activity) => activity.activity_id), ['ignored']);
});

test('archived listings do not appear in any image-review queue', () => {
  const archived = listing({ activity_id: 'archived', archive: true, public_listing_status: 'archived' });
  assert.deepEqual(queueCounts([archived]), {
    all_activities: 0,
    model_selected: 0,
    all_published: 0,
    all_draft: 0,
    missing_images: 0,
  });
  for (const queueId of ['all_activities', 'model_selected', 'all_published', 'all_draft', 'missing_images']) {
    assert.equal(activitiesForQueue([archived], queueId).length, 0);
  }
});

test('model-selected queue contains activities whose displayed image is the model image', () => {
  const activities = [
    listing({ activity_id: 'pending', address: '1 Pending Road, London', automated_image_review: { status: 'pending', candidate_index: 1 } }),
    listing({ activity_id: 'auto-applied', address: '2 Applied Road, London', model_selected_url: 'https://reviewed.test/model.jpg', automated_image_review: { status: 'auto_applied', candidate_index: 2 } }),
    listing({ activity_id: 'approved', address: '3 Approved Road, London', automated_image_review: { status: 'approved', candidate_index: 0 } }),
    listing({ activity_id: 'none', address: '4 Empty Road, London' }),
  ];
  assert.deepEqual(activitiesForQueue(activities, 'model_selected').map((activity) => activity.activity_id), ['auto-applied']);
});

test('model-selected images provide coverage while remaining distinct from manual review', () => {
  const modelSelected = listing({
    activity_id: 'model-selected',
    audit_image_status: 'needs_replacement',
    model_selected_url: 'https://storage.test/model.jpg',
    automated_image_review: { status: 'auto_applied', candidate_index: 1 },
  });
  assert.equal(activitiesForQueue([modelSelected], 'missing_images').length, 0);
  assert.deepEqual(activitiesForQueue([modelSelected], 'model_selected').map((activity) => activity.activity_id), ['model-selected']);
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
    activitiesToPreload(activities, ['all_activities', 'model_selected', 'all_published', 'all_draft', 'missing_images']).map((activity) => activity.activity_id),
    ['missing', 'draft', 'unsuitable', 'published', 'ignored'],
  );
});

test('advances the rolling preload pool when a missing listing is reviewed', () => {
  const activities = Array.from({ length: 21 }, (_, index) => listing({
    activity_id: `missing-${String(index + 1).padStart(2, '0')}`,
    activity_name: `Missing listing ${String(index + 1).padStart(2, '0')}`,
  }));
  const initial = prepareActivities(activities);
  assert.equal(
    activitiesToPreload(initial, ['missing_images'], 20).some((activity) => activity.activity_id === 'missing-21'),
    false,
  );

  const reviewed = prepareActivities(activities.map((activity) => activity.activity_id === 'missing-01'
    ? { ...activity, reviewed_image_url: 'https://reviewed.test/image.jpg' }
    : activity));
  assert.equal(
    activitiesToPreload(reviewed, ['missing_images'], 20).some((activity) => activity.activity_id === 'missing-21'),
    true,
  );
});

test('keeps a rolling window of 20 candidates ahead of the selected activity', () => {
  const prepared = prepareActivities(Array.from({ length: 22 }, (_, index) => listing({
    activity_id: `published-${String(index + 1).padStart(2, '0')}`,
    activity_name: `Published listing ${String(index + 1).padStart(2, '0')}`,
    website_image_url: 'https://images.test/existing.jpg',
  })));
  const targets = activitiesToPreload(prepared, ['all_published'], 20, { all_published: 'published-02' });
  assert.equal(targets.length, 20);
  assert.equal(targets[0].activity_id, 'published-02');
  assert.equal(targets[19].activity_id, 'published-21');
});

test('reports candidate readiness for the first 20 activities in each queue', () => {
  const prepared = prepareActivities([
    listing({ activity_id: 'ready', codex_image_candidates: [{ image_url: 'https://images.test/ready.jpg' }] }),
    listing({ activity_id: 'waiting' }),
    listing({ activity_id: 'draft', public_listing_status: 'draft', codex_image_candidates: [{ image_url: 'https://images.test/draft.jpg' }] }),
  ]);
  assert.deepEqual(
    preloadReadinessByQueue(prepared, ['missing_images', 'all_draft'], 20),
    {
      missing_images: { ready: 2, total: 3 },
      all_draft: { ready: 1, total: 1 },
    },
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

test('uses a stored Google Places URL when one is available', () => {
  assert.equal(
    googlePlacesUrl(listing({ google_place_uri: 'https://maps.google.com/?cid=123', google_link: 'https://google.test/fallback' })),
    'https://maps.google.com/?cid=123',
  );
});

test('builds a Google Maps search link for a listing without a stored place URL', () => {
  const url = new URL(googlePlacesUrl(listing()));
  assert.equal(url.hostname, 'www.google.com');
  assert.equal(url.searchParams.get('query'), 'Baby Sensory Leyton Leyton, London E10 5AB');
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
    label: 'Manual desktop review',
    sourceUrl: 'https://venue.test/gallery',
    sourceDomain: 'venue.test',
  });
  assert.equal(currentImage({ ...reviewed, admin_cover_image_url: 'https://storage.test/admin.jpg' }).field, 'admin_cover_image_url');
});

test('shows model-selected images below manual and user images with a distinct source label', () => {
  const modelSelected = listing({
    model_selected_url: 'https://storage.test/model.jpg',
    automated_image_review: {
      status: 'auto_applied',
      candidate: { source_page_url: 'https://venue.test/model-source' },
    },
  });
  assert.deepEqual(currentImage(modelSelected), {
    url: 'https://storage.test/model.jpg',
    field: 'model_selected_url',
    label: 'Model selected',
    sourceUrl: 'https://venue.test/model-source',
    sourceDomain: 'venue.test',
  });
  assert.equal(currentImage({ ...modelSelected, reviewed_image_url: 'https://storage.test/manual.jpg' }).field, 'reviewed_image_url');
  assert.equal(currentImage({ ...modelSelected, user_image_url: 'https://storage.test/user.jpg' }).field, 'user_image_url');
});

test('shows an explicitly selected category illustration at the reviewed-image priority', () => {
  const categoryChoice = listing({
    category: 'Parks & outdoor play',
    use_category_image: true,
    user_image_url: 'https://storage.test/user.jpg',
    model_selected_url: 'https://storage.test/model.jpg',
  });
  const image = currentImage(categoryChoice);
  assert.equal(image.field, 'category_placeholder');
  assert.equal(image.label, 'Illustrated category image');
  assert.match(image.url, /images\/park-placeholder\.svg$/);
  assert.equal(currentImage({ ...categoryChoice, admin_cover_image_url: 'https://storage.test/admin.jpg' }).field, 'admin_cover_image_url');
});

test('keeps category artwork displayed while returning the listing to the missing queue', () => {
  const categoryChoice = listing({
    activity_id: 'category-choice',
    category: 'Cafes & food',
    use_category_image: true,
    model_selected_url: 'https://storage.test/model.jpg',
  });

  assert.equal(currentImage(categoryChoice).field, 'category_placeholder');
  assert.match(currentImage(categoryChoice).url, /images\/family-cafe-placeholder\.svg$/);
  assert.deepEqual(
    activitiesForQueue([categoryChoice], 'missing_images').map((activity) => activity.activity_id),
    ['category-choice'],
  );
});

test('builds ordered displayed-image source options and counts category placeholders', () => {
  const activities = prepareActivities([
    listing({ activity_id: 'reviewed', address: 'Leyton, London E10', reviewed_image_url: 'https://storage.test/manual.jpg' }),
    listing({ activity_id: 'model', address: 'Hackney, London E8', model_selected_url: 'https://storage.test/model.jpg' }),
    listing({ activity_id: 'missing', address: 'Camden, London NW1' }),
    listing({ activity_id: 'category', address: 'Islington, London N1', use_category_image: true }),
  ]);

  assert.equal(displayedImageSource(activities[2]), 'category_placeholder');
  assert.deepEqual(imageSourceOptions(activities), [
    { field: 'reviewed_image_url', label: 'Manual desktop review', count: 1 },
    { field: 'model_selected_url', label: 'Model selected', count: 1 },
    { field: 'category_placeholder', label: 'Illustrated category image', count: 2 },
  ]);
});

test('adds labelled candidates from populated hierarchy and legacy source fields', () => {
  const candidates = storedImageCandidates(listing({
    user_image_url: 'https://storage.test/user.jpg',
    model_selected_url: 'https://storage.test/model.jpg',
    scraped_image_url: 'https://storage.test/scraped.jpg',
    image_source_url: 'https://venue.test/gallery',
  }));
  assert.deepEqual(candidates.map((candidate) => candidate.source_field), [
    'user_image_url',
    'model_selected_url',
    'scraped_image_url',
  ]);
  assert.equal(candidates[0].source_label, 'Admin image URL');
  assert.equal(candidates[2].source_page_url, 'https://venue.test/gallery');
});

test('round-trips stored-source candidate selection keys safely', () => {
  const selection = storedSourceSelectionKey('website_image_url');
  assert.equal(storedSourceFieldForSelection(selection), 'website_image_url');
  assert.equal(storedSourceFieldForSelection('stored_source:not_a_field'), '');
  assert.equal(storedSourceFieldForSelection(3), '');
});
