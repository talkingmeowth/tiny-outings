import assert from 'node:assert/strict';
import test from 'node:test';
import { candidateSourceGroup, currentActiveProposals, proposalAlternativePage, reviewedChoice } from './policy.js';

const proposal = { selected_image: { image_url: 'https://example.test/model.jpg', source_field: 'serpapi_image_candidates' },
  alternatives: [{ image_url: 'https://example.test/website.jpg', source_field: 'website_image_candidates' }] };
test('approves only a saved model or alternative image', () => {
  assert.equal(reviewedChoice(proposal, 'approved', 'https://example.test/model.jpg'), proposal.selected_image);
  assert.equal(reviewedChoice(proposal, 'approved', 'https://example.test/website.jpg'), proposal.alternatives[0]);
  assert.throws(() => reviewedChoice(proposal, 'approved', 'https://example.test/foreign.jpg'));
  assert.throws(() => reviewedChoice(proposal, 'approved', 'javascript:alert(1)'));
});
test('unsure and rejected decisions never choose or publish an image', () => {
  assert.equal(reviewedChoice(proposal, 'unsure', null), null);
  assert.equal(reviewedChoice(proposal, 'rejected', 'https://example.test/model.jpg'), null);
  assert.throws(() => reviewedChoice(proposal, 'other', null));
});

test('an admin-submitted URL can be approved only after it is saved as an alternative', () => {
  const submitted = { image_url: 'https://example.test/stored-photo.jpg',
    submitted_original_url: 'https://photos.example.org/photo.jpg', source_field: 'admin_submitted_url' };
  assert.throws(() => reviewedChoice(proposal, 'approved', submitted.image_url));
  assert.equal(reviewedChoice({ ...proposal, alternatives: [...proposal.alternatives, submitted] },
    'approved', submitted.image_url), submitted);
});

test('an already approved sibling can retain its propagated human-approved image', () => {
  const image = { image_url: 'https://example.test/session.jpg', propagated_from_activity_id: 'original' };
  assert.equal(reviewedChoice({ ...proposal, decision: 'approved', chosen_image: image }, 'approved', image.image_url), image);
  assert.throws(() => reviewedChoice({ ...proposal, decision: 'pending', chosen_image: image }, 'approved', image.image_url));
});

test('review queue follows current listing status and excludes archived activities', () => {
  const proposals = ['one', 'two', 'three'].map((activity_id) => ({ activity_id, activity_snapshot: { activity_name: activity_id, public_listing_status: 'draft' } }));
  const activities = [
    { activity_id: 'one', archive: false, public_listing_status: 'published' },
    { activity_id: 'two', archive: true, public_listing_status: 'published' },
  ];
  assert.deepEqual(currentActiveProposals(proposals, activities), [{
    activity_id: 'one', activity_snapshot: { activity_name: 'one', public_listing_status: 'published' },
  }]);
});

test('alternative images are paged without changing their order', () => {
  const alternatives = Array.from({ length: 55 }, (_, index) => ({ image_url: `https://example.test/${index}.jpg` }));
  assert.deepEqual(proposalAlternativePage({ alternatives }, 24, 24), {
    alternatives: alternatives.slice(24, 48), total: 55, next: 48,
    source_counts: { all: 55, social: 0, search: 0, website: 0, other: 55 }, source_filter: 'all',
  });
  assert.deepEqual(proposalAlternativePage({ alternatives }, 48, 99), {
    alternatives: alternatives.slice(48), total: 55, next: null,
    source_counts: { all: 55, social: 0, search: 0, website: 0, other: 55 }, source_filter: 'all',
  });
});

test('social candidates can be requested directly even when they occur late in the full gallery', () => {
  const alternatives = [
    { image_url: 'https://venue.test/room.jpg', source_field: 'website_image_candidates' },
    { image_url: 'https://lookaside.instagram.com/crawler/1', source_page_url: 'https://instagram.com/p/one' },
    { image_url: 'https://lookaside.fbsbx.com/crawler/2', source_domain: 'facebook.com' },
    { image_url: 'https://images.test/search.jpg', source_field: 'serpapi_image_candidates' },
  ];
  assert.equal(candidateSourceGroup(alternatives[1]), 'social');
  assert.deepEqual(proposalAlternativePage({ alternatives }, 0, 24, 'social'), {
    alternatives: alternatives.slice(1, 3), total: 2, next: null,
    source_counts: { all: 4, social: 2, search: 1, website: 1, other: 0 }, source_filter: 'social',
  });
});
