import test from 'node:test';
import assert from 'node:assert/strict';
import { trainingCandidates, buildTrainingBatch, httpUrl } from './image-training-cases.js';
test('candidate union keeps website/search/reference sources, deduplicates URLs, hides scores', () => {
  const c = trainingCandidates({ activity_id: 'a', serpapi_image_candidates: [{ original: 'https://x.test/a.jpg', title: 'Photo', metadata_score: 99, source_page_url: 'https://x.test/a' }],
    website_image_candidates: [{ original: 'https://x.test/a.jpg' }, { original: 'https://x.test/logo.svg' }], model_selected_url: 'https://x.test/b.jpg' },
  [{ image_url: 'https://x.test/c.jpg', ground_truth_label: 'approved' }]);
  assert.equal(c.length, 4); assert.deepEqual(c.find((c) => c.image_url.endsWith('a.jpg')).origins, ['Google Images', 'Website']);
  assert.ok(c.some((c) => c.image_url.endsWith('logo.svg'))); // reviewer decides, not the selector
  assert.doesNotMatch(JSON.stringify(c), /metadata_score|ground_truth_label|model_selected/);
});
test('disallows unsafe protocols and fairly mixes source groups', () => {
  assert.equal(httpUrl('javascript:alert(1)'), ''); assert.equal(httpUrl('file:///private'), '');
  const c = trainingCandidates({ activity_id: 'a', website_image_candidates: Array.from({ length: 40 }, (_, i) => ({ original: `https://x.test/${i}.jpg` })),
    serpapi_image_candidates: [{ original: 'https://y.test/image.jpg' }], reviewed_image_url: 'https://z.test/image.jpg' });
  assert.equal(new Set(c.slice(0, 3).map((c) => c.origins[0])).size, 3);
});
test('batch sampling is reproducible and holds out unseen independent groups', () => {
  const activities = Array.from({ length: 80 }, (_, i) => ({ activity_id: `a${i}`, activity_name: `Class ${i}`, category: `Category ${i % 8}`, source_name: `Importer ${i % 4}`, address: `Address ${i}`, public_listing_status: 'draft' }));
  const snapshot = { activities, groundTruth: activities.slice(0, 20).map((a) => ({ activity_id: a.activity_id, image_url: `https://x.test/${Math.floor(Number(a.activity_id.slice(1)) / 2)}.jpg` })) };
  const options = { development: 20, calibration: 5, holdout: 5 };
  const batch = buildTrainingBatch(snapshot, {}, [], options);
  assert.equal(batch.cases.length, 30); assert.equal(new Set(batch.cases.map((c) => c.evaluation_group_key)).size, 30);
  assert.ok(batch.cases.filter((c) => c.dataset_split !== 'development').every((c) => Number(c.activity_id.slice(1)) >= 20));
  assert.deepEqual(batch, buildTrainingBatch(snapshot, {}, [], options));
});
