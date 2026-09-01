import assert from 'node:assert/strict';
import test from 'node:test';
import {
  crossSourceCandidateSet,
  rankCrossSourceCandidates,
  rankStoredCandidates,
  storedCandidateSet,
  taggedChoiceGroups,
  trainTaggedImageRanker,
} from './tagged-image-ranker.js';

function candidates(activityName, selectedIndex = 0) {
  return Array.from({ length: 6 }, (_, index) => ({
    image_url: `https://images.example.test/${activityName}-${index}.jpg`,
    thumbnail_url: `https://images.example.test/${activityName}-${index}-thumb.jpg`,
    source_page_url: index === selectedIndex ? `https://official-${activityName}.test/gallery` : `https://directory-${index}.test/page`,
    source_domain: index === selectedIndex ? `official-${activityName}.test` : `directory-${index}.test`,
    title: index === selectedIndex ? `${activityName} interior seating venue` : `Unrelated result ${index}`,
    width: index === selectedIndex ? 1600 : 900,
    height: index === selectedIndex ? 1000 : 600,
  }));
}

function review(index) {
  const name = `cafe-${index}`;
  const selectedIndex = index % 3;
  const activityCandidates = candidates(name, selectedIndex);
  return {
    manual_review_id: `review-${index}`,
    original_image_url: activityCandidates[selectedIndex].image_url,
    activity: {
      activity_id: `activity-${index}`,
      activity_name: name,
      address: 'Hackney, London',
      category: 'Cafes & food',
      website: `https://official-${name}.test`,
      codex_image_candidates: activityCandidates,
    },
  };
}

test('normalizes legacy SerpAPI candidates without another API call', () => {
  const normalized = storedCandidateSet({
    serpapi_image_candidates: [{
      original: 'https://images.test/cafe.jpg',
      thumbnail: 'https://images.test/cafe-thumb.jpg',
      link: 'https://cafe.test/gallery',
      source: 'cafe.test',
      original_width: 1200,
      original_height: 800,
      position: 1,
    }],
  });
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].image_url, 'https://images.test/cafe.jpg');
  assert.equal(normalized[0].width, 1200);
  assert.equal(normalized[0].relevance_reason, 'Google Images result 1');
  assert.equal(normalized[0].candidate_set_index, 0);
});

test('falls back to official-website candidates and preserves their source index', () => {
  const normalized = storedCandidateSet({
    website_image_candidates: [
      { original: 'not-a-url' },
      {
        original: 'https://venue.test/interior.jpg',
        link: 'https://venue.test/gallery',
        title: 'Venue interior and seating',
        original_width: 1800,
        original_height: 1200,
      },
    ],
  }, 80);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].candidate_set_index, 1);
});

test('uses one selected candidate and the unselected set as tagged choice examples', () => {
  const groups = taggedChoiceGroups([review(1)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].selectedIndex, 1);
  assert.equal(groups[0].candidates.length, 6);
});

test('learns from manual choices and ranks an eligible candidate', () => {
  const rows = Array.from({ length: 30 }, (_, index) => review(index));
  const model = trainTaggedImageRanker(rows);
  const targetCandidates = candidates('new-place', 2);
  targetCandidates[0].title = 'New place logo icon';
  const result = rankStoredCandidates({
    activity_id: 'target',
    activity_name: 'new-place',
    address: 'Hackney, London',
    category: 'Cafes & food',
    website: 'https://official-new-place.test',
    codex_image_candidates: targetCandidates,
  }, model);
  assert.equal(model.trainingReviewCount, 30);
  assert.equal(result.candidateIndex, 2);
  assert.ok(result.confidence >= 0.5 && result.confidence <= 0.97);
  assert.match(result.reason, /Learned from 30 manual selections/);
});

test('never recommends Wikimedia outside the allowed categories', () => {
  const model = trainTaggedImageRanker(Array.from({ length: 30 }, (_, index) => review(index)));
  const result = rankStoredCandidates({
    activity_id: 'class-target',
    activity_name: 'Music class',
    category: 'Classes & clubs',
    codex_image_candidates: [
      { image_url: 'https://upload.wikimedia.org/best.jpg', source_domain: 'wikipedia.org', title: 'Music class', width: 1800, height: 1200 },
      { image_url: 'https://provider.test/class.jpg', source_domain: 'provider.test', title: 'Music class room', width: 1200, height: 800 },
    ],
  }, model);
  assert.equal(result.candidateIndex, 1);
});

test('uses the next learned choice after a candidate fails download validation', () => {
  const model = trainTaggedImageRanker(Array.from({ length: 30 }, (_, index) => review(index)));
  const targetCandidates = candidates('fallback-place', 0);
  const result = rankStoredCandidates({
    activity_id: 'fallback-target',
    activity_name: 'fallback-place',
    category: 'Cafes & food',
    website: 'https://official-fallback-place.test',
    codex_image_candidates: targetCandidates,
    automated_failed_image_urls: [targetCandidates[0].image_url],
  }, model);
  assert.notEqual(result.candidateIndex, 0);
  assert.match(result.reason, /Excluded 1 candidate/);
});

test('combines automatic fields, Google Images and official website candidates without fixed source priority', () => {
  const pool = crossSourceCandidateSet({
    activity_name: 'Little Explorers',
    category: 'Family activities',
    audit_image_status: 'replaced',
    audit_image_url: 'https://storage.test/audit.jpg',
    audit_image_source_url: 'https://provider.test/audit-source',
    serpapi_image_candidates: [{ original: 'https://search.test/result.jpg', link: 'https://directory.test/little-explorers' }],
    website_image_candidates: [{ original: 'https://provider.test/session.jpg', link: 'https://provider.test/little-explorers' }],
  });
  assert.deepEqual(new Set(pool.map((candidate) => candidate.candidate_source)), new Set([
    'audit_replacement',
    'google_images',
    'official_website_candidate',
  ]));
  assert.equal(pool.find((candidate) => candidate.source_field === 'audit_image_url').visual_status, 'approved');
});

test('requires visual approval and can choose an official-site source over the first Google result', () => {
  const model = trainTaggedImageRanker(Array.from({ length: 30 }, (_, index) => review(index)));
  const googleUrl = 'https://search.test/logo.jpg';
  const websiteUrl = 'https://official-new-place.test/interior.jpg';
  const target = {
    activity_id: 'cross-source-target',
    activity_name: 'new-place',
    address: 'Hackney, London',
    category: 'Cafes & food',
    source_name: 'Test importer',
    website: 'https://official-new-place.test',
    serpapi_image_candidates: [{ original: googleUrl, link: 'https://directory.test/new-place', title: 'new-place logo', original_width: 1600, original_height: 900 }],
    website_image_candidates: [{ original: websiteUrl, link: 'https://official-new-place.test/gallery', title: 'new-place interior seating', original_width: 1600, original_height: 1000 }],
  };
  const recommendation = rankCrossSourceCandidates(target, model, {
    visualAssessments: new Map([
      [googleUrl, { visual_status: 'rejected', visual_reason: 'Logo', visual_confidence: 0.1 }],
      [websiteUrl, { visual_status: 'approved', visual_reason: 'Clear cafe interior', visual_confidence: 0.91 }],
    ]),
  });
  assert.equal(recommendation.candidate.image_url, websiteUrl);
  assert.equal(recommendation.candidate.candidate_source, 'official_website_candidate');
  assert.ok(recommendation.confidence >= 0.7);
  assert.match(recommendation.reason, /visual assessment passed/i);
});

test('returns no automatic image when no cross-source candidate passes visual review', () => {
  const model = trainTaggedImageRanker(Array.from({ length: 30 }, (_, index) => review(index)));
  const imageUrl = 'https://search.test/uncertain.jpg';
  const recommendation = rankCrossSourceCandidates({
    activity_id: 'category-fallback-target',
    activity_name: 'Uncertain activity',
    category: 'Family activities',
    serpapi_image_candidates: [{ original: imageUrl, title: 'Uncertain activity', original_width: 1200, original_height: 800 }],
  }, model, {
    visualAssessments: new Map([[imageUrl, { visual_status: 'rejected', visual_reason: 'Unrelated image' }]]),
  });
  assert.equal(recommendation, null);
});
