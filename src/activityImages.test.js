import assert from 'node:assert/strict';
import test from 'node:test';
import { activityImageFields, activityImageUrls, shareListingImages } from './activityImages.js';

function activity(overrides = {}) {
  return {
    activity_id: crypto.randomUUID(),
    activity_name: 'Tiny swimmers',
    address: '1 Pool Road, London E10 1AA',
    start_time: '10:00',
    end_time: '10:30',
    model_selected_confidence: 0.8,
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
  const first = activity({ reviewed_image_url: 'https://images.example.test/first.jpg' });
  const second = activity({
    address: '2 Pool Road, London E8 1AA',
    reviewed_image_url: 'https://images.example.test/second.jpg',
  });

  const [sharedFirst, sharedSecond] = shareListingImages([first, second]);
  assert.equal(sharedFirst.shared_card_image_url, 'https://images.example.test/first.jpg');
  assert.equal(sharedSecond.shared_card_image_url, 'https://images.example.test/second.jpg');
});

test('ignores image_url because it is outside the image selection hierarchy', () => {
  const item = activity({ image_url: 'https://images.example.test/legacy.jpg' });
  assert.deepEqual(activityImageUrls(item), []);
});

test('does not display Wikimedia or other automatic sources until the learned selector approves one', () => {
  const wikimedia = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/venue.jpg';
  for (const category of ['Parks & outdoor play', 'Museums & culture', 'Family activities']) {
    assert.deepEqual(activityImageUrls(activity({ category, wikimedia_image_url: wikimedia })), []);
  }

  const cafe = activity({
    category: 'Cafes & food',
    wikimedia_image_url: wikimedia,
    website_image_url: 'https://cafe.example/interior.jpg',
  });
  assert.deepEqual(activityImageUrls(cafe), []);
});

test('uses one admin-approved cover across official Baby Sensory locations', () => {
  const woolwich = activity({
    activity_id: 'woolwich',
    activity_name: 'Baby Sensory Woolwich-Greenwich',
    address: 'Woolwich, London SE18 6HQ',
    organiser_website: 'https://www.babysensory.com/greenwich/',
    admin_cover_image_url: 'https://images.example.test/baby-sensory-cover.jpg',
  });
  const dulwich = activity({
    activity_id: 'dulwich',
    activity_name: 'Dulwich Baby Sensory',
    address: 'Dulwich, London SE21 7LD',
    website: 'https://www.babysensory.com/dulwich/',
    model_selected_url: 'https://images.example.test/dulwich-model.jpg',
  });

  const [sharedWoolwich, sharedDulwich] = shareListingImages([woolwich, dulwich]);
  assert.equal(sharedWoolwich.shared_card_image_url, woolwich.admin_cover_image_url);
  assert.equal(sharedDulwich.shared_card_image_url, woolwich.admin_cover_image_url);
  assert.equal(sharedDulwich.shared_card_image_source, 'admin_cover_image_url');
});

test('does not lend an official franchise image to an unrelated similarly named activity', () => {
  const official = activity({
    activity_name: 'Baby Sensory Southwark',
    organiser_website: 'https://www.babysensory.com/southwark/',
    admin_cover_image_url: 'https://images.example.test/official.jpg',
  });
  const unrelated = activity({
    activity_name: 'Quaggy Baby Sensory Stay and Play',
    address: 'Greenwich, London SE10 8RE',
    website: 'https://www.royalgreenwich.gov.uk/community-directory/quaggy',
  });

  const [, sharedUnrelated] = shareListingImages([official, unrelated]);
  assert.equal(sharedUnrelated.shared_card_image_url, undefined);
});

test('never promotes category artwork as a reusable cross-location cover', () => {
  const first = activity({
    activity_name: 'Baby Sensory Bromley',
    address: 'Bromley, London BR1 1AA',
    organiser_website: 'https://www.babysensory.com/bromley/',
    use_category_image: true,
  });
  const second = activity({
    activity_name: 'Baby Sensory Croydon',
    address: 'Croydon, London CR0 1AA',
    organiser_website: 'https://www.babysensory.com/croydon/',
  });

  const [, sharedSecond] = shareListingImages([first, second]);
  assert.equal(sharedSecond.shared_card_image_url, undefined);
});

test('keeps an audit-passed scraped image as candidate data rather than displaying it directly', () => {
  assert.deepEqual(activityImageUrls(activity({
    audit_image_status: 'pass',
    audit_image_original_source_field: 'scraped_image_url',
    audit_image_original_url: 'http://storage.example/activity-images/selected.jpg',
    scraped_image_url: 'https://storage.example/activity-images/selected.jpg',
  })), []);
});

test('skips an exact scraped image rejected or superseded by the audit', () => {
  for (const auditImageStatus of ['needs_replacement', 'no_replacement', 'replaced']) {
    const item = activity({
      audit_image_status: auditImageStatus,
      audit_image_original_source_field: 'scraped_image_url',
      audit_image_original_url: 'http://storage.example/activity-images/rejected.jpg',
      scraped_image_url: 'https://storage.example/activity-images/rejected.jpg',
      model_selected_url: 'https://images.example.test/model.jpg',
    });
    assert.deepEqual(activityImageUrls(item), []);
    assert.equal(shareListingImages([item])[0].shared_card_image_source, undefined);
  }
});

test('does not promote an unaudited scraped image when the audit covered a different source', () => {
  assert.deepEqual(activityImageUrls(activity({
    audit_image_status: 'needs_replacement',
    audit_image_original_source_field: 'website_image_url',
    audit_image_original_url: 'https://images.example.test/rejected-website.jpg',
    scraped_image_url: 'https://storage.example/activity-images/new-scraped.jpg',
  })), []);
});

test('displays admin, manual, desktop-approved, and user-uploaded images in order', () => {
  assert.deepEqual(activityImageFields, [
    'admin_cover_image_url',
    'user_image_url',
    'reviewed_image_url',
    'desktop_approved_image_url',
    'user_uploaded_image_url',
  ]);
  const item = activity({
    category: 'Family activities',
    audit_image_status: 'replaced',
    admin_cover_image_url: 'https://images.example.test/admin.jpg',
    reviewed_image_url: 'https://images.example.test/reviewed.jpg',
    desktop_approved_image_url: 'https://images.example.test/desktop-approved.jpg',
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
    'https://images.example.test/admin-url.jpg',
    'https://images.example.test/reviewed.jpg',
    'https://images.example.test/desktop-approved.jpg',
    'https://images.example.test/community.jpg',
  ]);

  const [shared] = shareListingImages([item]);
  assert.equal(shared.shared_card_image_source, 'admin_cover_image_url');
});

test('uses a desktop-reviewed image below admin URLs and above user uploads', () => {
  const reviewed = activity({
    reviewed_image_url: 'https://images.example.test/reviewed.jpg',
    user_image_url: 'https://images.example.test/admin-url.jpg',
    audit_image_status: 'replaced',
    audit_image_url: 'https://images.example.test/audited.jpg',
  });
  assert.deepEqual(activityImageUrls(reviewed), [
    'https://images.example.test/admin-url.jpg',
    'https://images.example.test/reviewed.jpg',
  ]);
  assert.equal(shareListingImages([reviewed])[0].shared_card_image_source, 'user_image_url');
  assert.equal(shareListingImages([{ ...reviewed, admin_cover_image_url: 'https://images.example.test/admin.jpg' }])[0].shared_card_image_source, 'admin_cover_image_url');
});

test('never shows model selections before explicit human review', () => {
  const modelSelected = activity({
    model_selected_url: 'https://images.example.test/model.jpg',
    user_image_url: 'https://images.example.test/admin-url.jpg',
  });
  assert.deepEqual(activityImageUrls(modelSelected), [
    'https://images.example.test/admin-url.jpg',
  ]);
  assert.equal(shareListingImages([modelSelected])[0].shared_card_image_source, 'user_image_url');
  assert.equal(shareListingImages([{ ...modelSelected, reviewed_image_url: 'https://images.example.test/manual.jpg' }])[0].shared_card_image_source, 'user_image_url');
});

test('does not let an unselected original source bypass the learned selector', () => {
  const rejected = activity({
    audit_image_status: 'needs_replacement',
    audit_image_url: 'https://images.example.test/invalid-audit-copy.jpg',
    website_image_url: 'https://images.example.test/restored-original.jpg',
  });
  assert.deepEqual(activityImageUrls(rejected), []);
  assert.equal(shareListingImages([rejected])[0].shared_card_image_source, undefined);
});

test('a desktop-approved choice is live, but cannot override an older manual review', () => {
  const item = activity({
    model_selected_url: 'https://images.example.test/unreviewed-model.jpg',
    desktop_approved_image_url: 'https://images.example.test/approved-alternative.jpg',
    user_uploaded_image_url: 'https://images.example.test/user-upload.jpg',
  });
  assert.deepEqual(activityImageUrls(item), [
    'https://images.example.test/approved-alternative.jpg',
    'https://images.example.test/user-upload.jpg',
  ]);
  assert.equal(shareListingImages([item])[0].shared_card_image_source, 'desktop_approved_image_url');
  assert.equal(shareListingImages([{ ...item, reviewed_image_url: 'https://images.example.test/manual.jpg' }])[0].shared_card_image_source, 'reviewed_image_url');
  assert.equal(shareListingImages([{ ...item, admin_cover_image_url: 'https://images.example.test/admin.jpg' }])[0].shared_card_image_source, 'admin_cover_image_url');
});

test('keeps validated audit replacements in the candidate pool until a learned winner is stored', () => {
  const replacement = activity({
    audit_image_status: 'replaced',
    audit_image_url: 'https://images.example.test/audit-replacement.jpg',
    audit_image_source_url: 'https://images.example.test/audit-replacement.jpg',
    website_image_url: 'https://images.example.test/lower-priority.jpg',
  });
  assert.deepEqual(activityImageUrls(replacement), []);
  assert.equal(shareListingImages([replacement])[0].shared_card_image_source, undefined);
});

test('keeps all model outputs in the non-live review pool', () => {
  const modelUrl = 'https://images.example.test/model.jpg';
  assert.deepEqual(activityImageUrls(activity({ model_selected_url: modelUrl, model_selected_confidence: 0.42 })), []);
  assert.deepEqual(activityImageUrls(activity({ model_selected_url: modelUrl, model_selected_confidence: 0.49 })), []);
  assert.deepEqual(activityImageUrls(activity({ model_selected_url: modelUrl, model_selected_confidence: null })), []);
  assert.deepEqual(activityImageUrls(activity({ model_selected_url: modelUrl, model_selected_confidence: 0.50 })), []);
  assert.deepEqual(activityImageUrls(activity({
    model_selected_url: modelUrl,
    model_selected_confidence: 0.42,
    image_review_approved_source_field: 'model_selected_url',
    image_review_approved_url: modelUrl,
  })), []);
});

test('uses an explicitly selected category illustration at the reviewed-image priority', () => {
  const categoryChoice = activity({
    category: 'Cafes & food',
    use_category_image: true,
    reviewed_image_url: 'https://images.example.test/old-reviewed.jpg',
    desktop_approved_image_url: 'https://images.example.test/desktop-approved.jpg',
    user_image_url: 'https://images.example.test/admin-url.jpg',
    model_selected_url: 'https://images.example.test/model.jpg',
  });
  assert.deepEqual(activityImageUrls(categoryChoice), [
    'https://images.example.test/admin-url.jpg',
    '/images/family-cafe-placeholder.svg',
  ]);
  assert.equal(shareListingImages([categoryChoice])[0].shared_card_image_source, 'user_image_url');
  assert.equal(shareListingImages([{ ...categoryChoice, admin_cover_image_url: 'https://images.example.test/admin.jpg' }])[0].shared_card_image_source, 'admin_cover_image_url');
});

test('an admin cover can replace an image that failed the non-admin audit', () => {
  const overridden = activity({
    audit_image_status: 'needs_replacement',
    audit_image_original_source_field: 'scraped_image_url',
    audit_image_original_url: 'https://images.example.test/rejected-logo.jpg',
    admin_cover_image_url: 'https://images.example.test/admin-approved.jpg',
    scraped_image_url: 'https://images.example.test/rejected-logo.jpg',
  });
  assert.deepEqual(activityImageUrls(overridden), ['https://images.example.test/admin-approved.jpg']);
});

test('does not use scraped Wikimedia content outside the permitted categories', () => {
  const scrapedImage = 'https://storage.example/activity-images/wikimedia-copy.jpg';
  const source = 'https://commons.wikimedia.org/wiki/File:Venue.jpg';
  const cafe = activity({
    category: 'Cafes & food',
    audit_image_status: 'pass',
    audit_image_original_source_field: 'scraped_image_url',
    audit_image_original_url: scrapedImage,
    scraped_image_url: scrapedImage,
    image_source_url: source,
    website_image_url: 'https://cafe.example/interior.jpg',
  });
  assert.deepEqual(activityImageUrls(cafe), []);
  assert.deepEqual(activityImageUrls({ ...cafe, category: 'Family activities' }), []);
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
