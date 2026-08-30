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
  const first = activity({ website_image_url: 'https://images.example.test/first.jpg' });
  const second = activity({
    address: '2 Pool Road, London E8 1AA',
    website_image_url: 'https://images.example.test/second.jpg',
  });

  const [sharedFirst, sharedSecond] = shareListingImages([first, second]);
  assert.equal(sharedFirst.shared_card_image_url, 'https://images.example.test/first.jpg');
  assert.equal(sharedSecond.shared_card_image_url, 'https://images.example.test/second.jpg');
});

test('ignores image_url because it is outside the image selection hierarchy', () => {
  const item = activity({ image_url: 'https://images.example.test/legacy.jpg' });
  assert.deepEqual(activityImageUrls(item), []);
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

test('ignores scraped images because they are outside the card-image hierarchy', () => {
  assert.deepEqual(activityImageUrls(activity({
    scraped_image_url: 'https://storage.example/activity-images/selected.jpg',
  })), []);
});

test('uses the requested card-image hierarchy exactly', () => {
  const item = activity({
    category: 'Family activities',
    audit_image_status: 'replaced',
    admin_cover_image_url: 'https://images.example.test/admin.jpg',
    reviewed_image_url: 'https://images.example.test/reviewed.jpg',
    model_selected_url: 'https://images.example.test/model.jpg',
    user_image_url: 'https://images.example.test/admin-url.jpg',
    audit_image_url: 'https://images.example.test/audited.jpg',
    user_uploaded_image_url: 'https://images.example.test/community.jpg',
    scraped_image_url: 'https://images.example.test/scraped.jpg',
    organiser_website_downloaded_image: 'https://images.example.test/organiser.jpg',
    website_downloaded_image: 'https://images.example.test/website-download.jpg',
    wikimedia_image_url: 'https://images.example.test/wikimedia.jpg',
    website_image_url: 'https://images.example.test/website.jpg',
    listing_image_url: 'https://images.example.test/listing.jpg',
  });
  assert.deepEqual(activityImageUrls(item), [
    'https://images.example.test/admin.jpg',
    'https://images.example.test/reviewed.jpg',
    'https://images.example.test/model.jpg',
    'https://images.example.test/admin-url.jpg',
    'https://images.example.test/audited.jpg',
    'https://images.example.test/community.jpg',
    'https://images.example.test/organiser.jpg',
    'https://images.example.test/website-download.jpg',
    'https://images.example.test/wikimedia.jpg',
    'https://images.example.test/website.jpg',
    'https://images.example.test/listing.jpg',
  ]);

  const [shared] = shareListingImages([item]);
  assert.equal(shared.shared_card_image_source, 'admin_cover_image_url');
});

test('uses a desktop-reviewed image below an admin cover and above other sources', () => {
  const reviewed = activity({
    reviewed_image_url: 'https://images.example.test/reviewed.jpg',
    user_image_url: 'https://images.example.test/admin-url.jpg',
    audit_image_status: 'replaced',
    audit_image_url: 'https://images.example.test/audited.jpg',
  });
  assert.deepEqual(activityImageUrls(reviewed), [
    'https://images.example.test/reviewed.jpg',
    'https://images.example.test/admin-url.jpg',
    'https://images.example.test/audited.jpg',
  ]);
  assert.equal(shareListingImages([reviewed])[0].shared_card_image_source, 'reviewed_image_url');
  assert.equal(shareListingImages([{ ...reviewed, admin_cover_image_url: 'https://images.example.test/admin.jpg' }])[0].shared_card_image_source, 'admin_cover_image_url');
});

test('keeps model selections distinct and below manually reviewed images', () => {
  const modelSelected = activity({
    model_selected_url: 'https://images.example.test/model.jpg',
    user_image_url: 'https://images.example.test/admin-url.jpg',
  });
  assert.deepEqual(activityImageUrls(modelSelected), [
    'https://images.example.test/model.jpg',
    'https://images.example.test/admin-url.jpg',
  ]);
  assert.equal(shareListingImages([modelSelected])[0].shared_card_image_source, 'model_selected_url');
  assert.equal(shareListingImages([{ ...modelSelected, reviewed_image_url: 'https://images.example.test/manual.jpg' }])[0].shared_card_image_source, 'reviewed_image_url');
});

test('keeps an original hierarchy source visible when its audit needs replacement', () => {
  const rejected = activity({
    audit_image_status: 'needs_replacement',
    audit_image_url: 'https://images.example.test/invalid-audit-copy.jpg',
    website_image_url: 'https://images.example.test/restored-original.jpg',
  });
  assert.deepEqual(activityImageUrls(rejected), ['https://images.example.test/restored-original.jpg']);
  assert.equal(shareListingImages([rejected])[0].shared_card_image_source, 'website_image_url');
});

test('uses audit_image_url for a genuine audit replacement', () => {
  const replacement = activity({
    audit_image_status: 'replaced',
    audit_image_url: 'https://images.example.test/audit-replacement.jpg',
    audit_image_source_url: 'https://images.example.test/audit-replacement.jpg',
    website_image_url: 'https://images.example.test/lower-priority.jpg',
  });
  assert.deepEqual(activityImageUrls(replacement), [
    'https://images.example.test/audit-replacement.jpg',
    'https://images.example.test/lower-priority.jpg',
  ]);
  assert.equal(shareListingImages([replacement])[0].shared_card_image_source, 'audit_image_url');
});

test('an admin cover can replace an image that failed the non-admin audit', () => {
  const overridden = activity({
    audit_image_status: 'needs_replacement',
    admin_cover_image_url: 'https://images.example.test/admin-approved.jpg',
    scraped_image_url: 'https://images.example.test/rejected-logo.jpg',
  });
  assert.deepEqual(activityImageUrls(overridden), ['https://images.example.test/admin-approved.jpg']);
});

test('an admin-curated URL remains ahead of restored community sources', () => {
  const overridden = activity({
    audit_image_status: 'needs_replacement',
    user_image_url: 'https://images.example.test/admin-url-approved.jpg',
    user_uploaded_image_url: 'https://images.example.test/unreviewed-community.jpg',
  });
  assert.deepEqual(activityImageUrls(overridden), [
    'https://images.example.test/admin-url-approved.jpg',
    'https://images.example.test/unreviewed-community.jpg',
  ]);
  assert.equal(shareListingImages([overridden])[0].shared_card_image_source, 'user_image_url');
});
