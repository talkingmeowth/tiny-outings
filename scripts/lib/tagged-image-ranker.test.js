import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
