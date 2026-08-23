import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessCafeSerpApiPresentation,
  assessScrapedImage,
  cafePresentationSummary,
  imageAuditSummary,
  isSerpApiLogoImage,
} from './scraped-image-audit-policy.js';

function activity(overrides = {}) {
  return {
    activity_name: 'Sunbeam Play Cafe',
    category: 'Play cafes',
    description: 'A friendly indoor play space.',
    scraped_image_url: 'https://cdn.example.test/photos/sunbeam-play-cafe-interior.jpg?width=1200&height=800',
    image_source_url: 'https://sunbeam.example.test/gallery/interior',
    website: 'https://sunbeam.example.test/',
    organiser_website: null,
    google_place_id: 'place-id',
    google_primary_type: 'cafe',
    ...overrides,
  };
}

test('passes a clear activity image from the official venue website', () => {
  const assessment = assessScrapedImage(activity());
  assert.equal(assessment.severity, 'pass');
  assert.equal(assessment.google_place_aligned, true);
});

test('marks utility and social image assets for an automatic SerpAPI refresh', () => {
  const assessment = assessScrapedImage(activity({
    scraped_image_url: 'https://facebook.com/logo.png',
    image_source_url: 'https://facebook.com/logo.png',
  }));
  assert.equal(assessment.severity, 'refresh');
});

test('does not mistake a description about social development for a social-media image', () => {
  const assessment = assessScrapedImage(activity({
    description: 'A friendly group that supports social development through play.',
  }));
  assert.equal(assessment.severity, 'pass');
});

test('marks an unknown-provenance image for review without replacing it blindly', () => {
  const assessment = assessScrapedImage(activity({
    image_source_url: null,
    scraped_image_url: 'https://storage.example.test/image.jpg',
  }));
  assert.equal(assessment.severity, 'review');
});

test('flags a Google Places type that conflicts with the category', () => {
  const assessment = assessScrapedImage(activity({ google_primary_type: 'library' }));
  assert.equal(assessment.severity, 'review');
  assert.equal(assessment.google_place_aligned, false);
});

test('summarises every audit outcome', () => {
  const rows = [
    { assessment: { severity: 'pass' } },
    { assessment: { severity: 'review' } },
    { assessment: { severity: 'refresh' } },
  ];
  assert.deepEqual(imageAuditSummary(rows), { pass: 1, review: 1, refresh: 1, missing: 0 });
});

test('refreshes food and logo cafe cards but retains venue interiors and exteriors', () => {
  assert.equal(assessCafeSerpApiPresentation(activity({
    scraped_image_url: 'https://storage.example.test/venue.jpg',
    image_source_url: 'https://example.test/cafe-interior.jpg',
  })).outcome, 'retain');
  assert.equal(assessCafeSerpApiPresentation(activity({
    scraped_image_url: 'https://storage.example.test/venue.jpg',
    image_source_url: 'https://example.test/cafe-shopfront.jpg',
  })).outcome, 'retain');
  assert.equal(assessCafeSerpApiPresentation(activity({
    scraped_image_url: 'https://storage.example.test/venue.jpg',
    image_source_url: 'https://example.test/cafe-pastry.jpg',
  })).outcome, 'refresh');
  assert.equal(assessCafeSerpApiPresentation(activity({
    scraped_image_url: 'https://storage.example.test/venue.jpg',
    image_source_url: 'https://example.test/cafe-logo.png',
  })).outcome, 'refresh');
});

test('summarises cafe presentation review outcomes', () => {
  assert.deepEqual(cafePresentationSummary([
    { assessment: { outcome: 'retain' } },
    { assessment: { outcome: 'review' } },
    { assessment: { outcome: 'refresh' } },
  ]), { retain: 1, review: 1, refresh: 1 });
});

test('identifies SerpAPI logo assets in every activity category', () => {
  assert.equal(isSerpApiLogoImage(activity({
    category: 'Museums & culture',
    image_source_url: 'https://example.test/assets/venue-logo.png',
  })), true);
  assert.equal(isSerpApiLogoImage(activity({
    category: 'Museums & culture',
    image_source_url: 'https://example.test/assets/venue-front.jpg',
  })), false);
});
