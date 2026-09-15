import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateTrainingReview, trainingLabelCounts } from '../../supabase/functions/image-training-review/policy.js';
import { restoreTrainingRoute, TRAINING_RETURN_KEY } from './trainingRoute.js';
const c = { candidate_set_hash: 'test-hash', candidates: [{ candidate_id: 'a' }, { candidate_id: 'b' }, { candidate_id: 'c' }] };
const good = { candidate_set_hash: 'test-hash', request_id: '00000000-0000-4000-8000-000000000001', labels: [{ candidate_id: 'a', label: 'acceptable' }], preferred_candidate_id: 'a', outcome: 'selected' };
test('accepts multiple useful alternatives, but never labels unseen candidates negative', () => {
  const r = validateTrainingReview(c, { ...good, labels: [...good.labels, { candidate_id: 'b', label: 'acceptable' }] });
  assert.equal(r.labels.length, 2); assert.equal(r.preferred_candidate_id, 'a'); assert.ok(!r.labels.some((r) => r.candidate_id === 'c'));
});
test('requires an explicit usable favourite', () => {
  assert.throws(() => validateTrainingReview(c, { ...good, preferred_candidate_id: 'b' }), /favourite/);
  assert.throws(() => validateTrainingReview(c, { ...good, labels: [] }), /favourite/);
});
test('rejections require reasons and cannot masquerade as a favourite', () => {
  assert.throws(() => validateTrainingReview(c, { ...good, labels: [{ candidate_id: 'a', label: 'unsuitable' }] }), /reason/);
  const r = validateTrainingReview(c, { ...good, labels: [{ candidate_id: 'a', label: 'unsuitable', reason: 'wrong_location' }], outcome: 'none_suitable', preferred_candidate_id: null });
  assert.equal(r.labels[0].reason, 'wrong_location'); assert.equal(r.labels.length, 1);
});
test('unavailable and uncertain images stay separate from negative labels', () => {
  const labels = [{ candidate_id: 'a', label: 'unavailable' }, { candidate_id: 'b', label: 'unsure' }];
  const r = validateTrainingReview(c, { ...good, labels, preferred_candidate_id: null, outcome: 'cannot_verify' });
  assert.deepEqual(r.labels.map((r) => r.label), ['unavailable', 'unsure']);
  assert.throws(() => validateTrainingReview(c, { ...good, labels, preferred_candidate_id: null, outcome: 'none_suitable' }), /unsuitable photos/);
});
test('empty candidate pools can request more images without a fabricated rejection', () => {
  const r = validateTrainingReview({ ...c, candidates: [] }, { ...good, labels: [], preferred_candidate_id: null, outcome: 'needs_candidates' });
  assert.equal(r.labels.length, 0);
});
test('rejects stale snapshot, foreign candidates, duplicate labels, invalid states and save IDs', () => {
  for (const change of [{ candidate_set_hash: 'old' }, { request_id: 'oops' }, { outcome: 'publish' }, { labels: [{ candidate_id: 'foreign', label: 'acceptable' }] },
    { labels: [good.labels[0], good.labels[0]] }, { labels: [{ candidate_id: 'a', label: 'made-up' }] }]) assert.throws(() => validateTrainingReview(c, { ...good, ...change }));
});
test('none suitable cannot silently discard accepted photos', () => assert.throws(() => validateTrainingReview(c, { ...good, outcome: 'none_suitable' }), /clear them/));
test('notes are bounded and label counts are explicit', () => {
  assert.equal(validateTrainingReview(c, { ...good, notes: 'a'.repeat(2200) }).notes.length, 2000);
  assert.deepEqual(trainingLabelCounts({ a: { label: 'acceptable' }, b: { label: 'unavailable' } }), { acceptable: 1, unsuitable: 0, unsure: 0, unavailable: 1 });
});
test('Google sign-in restores the training deep link and preserves the OAuth code', () => {
  let target; const storage = new Map([[TRAINING_RETURN_KEY, 'https://example.test/review/?view=training&batch=test&case=abc']]);
  const win = { location: { href: 'https://example.test/review/?code=oauth-code' }, sessionStorage: { getItem: (k) => storage.get(k), removeItem: (k) => storage.delete(k) }, history: { replaceState: (_a, _b, v) => { target = new URL(v); } } };
  restoreTrainingRoute(win); assert.equal(target.searchParams.get('view'), 'training'); assert.equal(target.searchParams.get('code'), 'oauth-code'); assert.equal(target.searchParams.get('case'), 'abc');
});
test('OAuth return cannot redirect outside the review origin', () => {
  let changed = false;
  restoreTrainingRoute({ location: { href: 'https://example.test/review/?code=a' }, sessionStorage: { getItem: () => 'https://evil.test/review/?view=training', removeItem: () => {} }, history: { replaceState: () => { changed = true; } } });
  assert.equal(changed, false);
});
test('training does not load the legacy queue or invoke search/live-image writes', () => {
  const main = readFileSync(new URL('./main.jsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('./TrainingApp.jsx', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../../supabase/functions/image-training-review/index.ts', import.meta.url), 'utf8');
  assert.match(main, /training \? import\('\.\/TrainingApp.jsx'\) : import\('\.\/App.jsx'\)/);
  assert.doesNotMatch(app, /image-review-admin|serpapi.*invoke|activity-image-auto-review/);
  assert.doesNotMatch(server, /from\(['"]activities['"]\)|\.update\(|\.delete\(/);
});
test('database keeps evaluation answers out of the training view and locks direct access', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20260916110000_add_mobile_image_training_review.sql', import.meta.url), 'utf8');
  assert.match(sql, /dataset_split = 'development' and label in \('acceptable', 'unsuitable'\)/);
  assert.match(sql, /held\.dataset_split in \('calibration','holdout'\)/);
  assert.match(sql, /revoke all[\s\S]*from public, anon, authenticated/);
});
