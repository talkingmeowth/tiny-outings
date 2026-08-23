import assert from 'node:assert/strict';
import test from 'node:test';
import { isClearCafeLogoCandidate, isUsableActivityImageUrl, scoreActivityImage } from './activity-image-policy.js';

const cafe = { activity_name: 'Suba Cafe', category: 'Cafes and food' };

test('rejects social, flag, and low-quality utility images', () => {
  assert.equal(isUsableActivityImageUrl('https://facebook.com/logo.png'), false);
  assert.equal(isUsableActivityImageUrl('https://example.test/images/union-jack.png'), false);
  assert.equal(isUsableActivityImageUrl('https://example.test/images/loading-spinner.gif'), false);
});

test('accepts a clear cafe logo only as a controlled fallback', () => {
  const logo = 'https://cdn.example.test/suba-cafe-logo.png?width=600&height=400';
  assert.equal(isClearCafeLogoCandidate(logo, 'Suba Cafe logo', cafe), true);
  assert.equal(isUsableActivityImageUrl(logo), false);
});

test('prioritises cafe interiors above food and logo fallbacks', () => {
  const interior = scoreActivityImage('https://cdn.example.test/suba-cafe-interior.jpg?width=1400&height=900', 'inside the cafe', cafe);
  const food = scoreActivityImage('https://cdn.example.test/suba-cafe-pastry.jpg?width=1400&height=900', 'fresh food', cafe);
  const logo = scoreActivityImage('https://cdn.example.test/suba-cafe-logo.png?width=600&height=400', 'Suba Cafe logo', cafe);

  assert.ok(interior > food);
  assert.ok(food > logo);
});
