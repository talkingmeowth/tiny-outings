import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseShortlist,
  hammingDistance,
  imageCacheKey,
  scoreCandidateMetadata,
} from './codex-image-shortlist-policy.js';

const cafe = {
  activity_id: 'cafe-1',
  activity_name: 'Bright Bean Cafe',
  category: 'Cafes & food',
  address: '10 High Street, Hackney, London E8 1AA',
  postcode: 'E8 1AA',
  borough: 'Hackney',
  serpapi_image_search_ward: 'Dalston',
  website: 'https://brightbean.example/visit',
};

function candidate(overrides = {}) {
  return {
    original: 'https://brightbean.example/images/interior.jpg',
    link: 'https://brightbean.example/visit',
    title: 'Bright Bean Cafe Dalston interior and seating',
    source: 'Bright Bean Cafe',
    position: 1,
    original_width: 1600,
    original_height: 1000,
    ...overrides,
  };
}

test('official cafe interiors score above food-only directory photos', () => {
  const interior = scoreCandidateMetadata(cafe, candidate(), 0);
  const food = scoreCandidateMetadata(cafe, candidate({
    original: 'https://directory.example/plate.jpg',
    link: 'https://directory.example/restaurants/bright-bean',
    title: 'Bright Bean Cafe breakfast plate and latte',
    source: 'Restaurant directory',
    position: 2,
  }), 1);
  assert.ok(interior.score > food.score + 30);
  assert.equal(interior.official, true);
});

test('logos and extreme aspect ratios are rejected before vision review', () => {
  const logo = scoreCandidateMetadata(cafe, candidate({ title: 'Bright Bean Cafe logo' }), 0);
  const banner = scoreCandidateMetadata(cafe, candidate({ original_width: 2000, original_height: 200 }), 1);
  assert.equal(logo.rejected, true);
  assert.match(logo.reject_reasons.join(' '), /graphic/);
  assert.equal(banner.rejected, true);
  assert.match(banner.reject_reasons.join(' '), /aspect/);
});

test('generic overseas venues are rejected without activity identity evidence', () => {
  const wrongPlayground = scoreCandidateMetadata({
    activity_name: 'Sandal Street Park',
    category: 'Parks & outdoor play',
    address: 'Sandal Street, London E15 3NR',
    borough: 'Newham',
  }, candidate({
    original: 'https://city.example/playground.jpg',
    link: 'https://city.example/parks/all-together-playground',
    title: 'All Together Inclusive Playground - City of Albert Lea, Minnesota',
    source: 'City of Albert Lea',
  }), 0);
  assert.equal(wrongPlayground.rejected, true);
  assert.match(wrongPlayground.reject_reasons.join(' '), /identity/);
});

test('a nearby but differently named venue is not accepted on location alone', () => {
  const nearbyPark = scoreCandidateMetadata({
    activity_name: 'Sandal Street Park',
    category: 'Parks & outdoor play',
    address: 'Sandal Street, London E15 3NR',
    borough: 'Newham',
  }, candidate({
    original: 'https://directory.example/plashet.jpg',
    link: 'https://directory.example/newham/plashet-park',
    title: 'Plashet Park playground in Newham',
    source: 'London playground directory',
  }), 0);
  assert.equal(nearbyPark.rejected, true);
  assert.match(nearbyPark.reject_reasons.join(' '), /identity/);
});

test('near duplicate hashes keep only the stronger candidate', () => {
  const rows = [
    { index: 0, total_score: 90, perceptual_hash: '0000000000000000', rejected: false, reject_reasons: [] },
    { index: 1, total_score: 80, perceptual_hash: '0000000000000001', rejected: false, reject_reasons: [] },
    { index: 2, total_score: 70, perceptual_hash: 'ffffffffffffffff', rejected: false, reject_reasons: [] },
  ];
  const result = chooseShortlist(rows, 5, 2);
  assert.deepEqual(result.map((row) => row.index), [0, 2]);
  assert.equal(rows[1].reject_reasons.includes('near_duplicate'), true);
  assert.equal(hammingDistance(rows[0].perceptual_hash, rows[1].perceptual_hash), 1);
});

test('shortlist keeps three choices when weaker extras are far behind', () => {
  const rows = [90, 82, 76, 60, 40].map((score, index) => ({
    index,
    total_score: score,
    perceptual_hash: index.toString(16).repeat(16),
    rejected: false,
    reject_reasons: [],
  }));
  const result = chooseShortlist(rows, 5, 3);
  assert.deepEqual(result.map((row) => row.index), [0, 1, 2]);
});

test('cache keys change with candidate URL but stay scoped to the activity', () => {
  const first = imageCacheKey('activity-1', 2, 'https://images.example/a.jpg');
  const second = imageCacheKey('activity-1', 2, 'https://images.example/b.jpg');
  assert.match(first, /^activity-1\/2-[a-f0-9]{12}\.jpg$/);
  assert.notEqual(first, second);
});
