import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CAFE_IMAGE_CONTENT_LABELS,
  assessCafeImageContent,
  cafeImageContentSummary,
} from './cafe-image-content-policy.js';

function results(scores) {
  return CAFE_IMAGE_CONTENT_LABELS.map((label) => ({ label, score: scores[label] || 0 }));
}

test('keeps a cafe interior or exterior when visual classification is decisive', () => {
  const assessment = assessCafeImageContent(results({
    [CAFE_IMAGE_CONTENT_LABELS[0]]: 0.71,
    [CAFE_IMAGE_CONTENT_LABELS[1]]: 0.14,
    [CAFE_IMAGE_CONTENT_LABELS[2]]: 0.08,
  }));
  assert.equal(assessment.outcome, 'retain');
  assert.equal(assessment.reason, 'Clear venue exterior.');
});

test('queues a food photo for a venue-image replacement', () => {
  const assessment = assessCafeImageContent(results({
    [CAFE_IMAGE_CONTENT_LABELS[0]]: 0.12,
    [CAFE_IMAGE_CONTENT_LABELS[2]]: 0.72,
    [CAFE_IMAGE_CONTENT_LABELS[3]]: 0.08,
  }));
  assert.equal(assessment.outcome, 'refresh');
  assert.equal(assessment.reason, 'Food or menu image.');
});

test('leaves uncertain image classifications for review rather than replacing blindly', () => {
  const assessment = assessCafeImageContent(results({
    [CAFE_IMAGE_CONTENT_LABELS[0]]: 0.31,
    [CAFE_IMAGE_CONTENT_LABELS[1]]: 0.25,
    [CAFE_IMAGE_CONTENT_LABELS[2]]: 0.29,
    [CAFE_IMAGE_CONTENT_LABELS[3]]: 0.15,
  }));
  assert.equal(assessment.outcome, 'review');
});

test('summarises visual cafe-image audit outcomes', () => {
  assert.deepEqual(cafeImageContentSummary([
    { assessment: { outcome: 'retain' } },
    { assessment: { outcome: 'review' } },
    { assessment: { outcome: 'refresh' } },
    { assessment: { outcome: 'failed' } },
  ]), { retain: 1, review: 1, refresh: 1, failed: 1 });
});
