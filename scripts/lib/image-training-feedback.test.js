import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareImageTrainingFeedback, diagnoseExistingImageChoices } from './image-training-feedback.js';

const c = (id, split = 'development') => ({ case_id: id, activity_id: id, dataset_split: split, evaluation_group_key: id, candidate_set_hash: 'h', activity_snapshot: { activity_name: id, address: id } });
const label = (reviewCase, id, value) => ({ ...reviewCase, review_id: 'review', candidate: { candidate_id: id, image_url: `https://example.test/${id}.jpg` }, label: value, reason: value === 'unsuitable' ? 'wrong_activity' : null });
test('exports explicit positives and negatives only, with disjoint calibration and holdout answers', () => {
  const cases = [c('dev'), c('cal', 'calibration'), c('test', 'holdout')];
  const f = prepareImageTrainingFeedback({ cases, labels: [label(cases[0], 'a', 'acceptable'), label(cases[0], 'b', 'acceptable'), label(cases[0], 'c', 'unsuitable'), label(cases[0], 'd', 'unsure'), label(cases[0], 'e', 'unavailable'), label(cases[1], 'f', 'acceptable'), label(cases[2], 'g', 'unsuitable')] });
  assert.equal(f.training_examples.length, 3); assert.equal(f.uncertain_or_unavailable.length, 2);
  assert.equal(f.calibration_examples.length, 1); assert.equal(f.holdout_examples.length, 1);
});
test('blocks a related reserved group and a repeated reserved image URL', () => {
  const cases = [c('dev'), c('related'), c('held', 'holdout')]; cases[1].evaluation_group_key = 'held';
  const f = prepareImageTrainingFeedback({ cases, labels: [label(cases[0], 'same', 'acceptable'), label(cases[1], 'other', 'acceptable'), label(cases[2], 'same', 'acceptable')] });
  assert.equal(f.training_examples.length, 0); assert.equal(f.excluded_for_split_protection.length, 2);
});
test('rejects stale hashes and tampered split assignments', () => {
  for (const extra of [{ candidate_set_hash: 'stale' }, { dataset_split: 'holdout' }]) assert.throws(() => prepareImageTrainingFeedback({ cases: [c('dev')], labels: [{ ...label(c('dev'), 'a', 'acceptable'), ...extra }] }), /Stale/);
});
test('a prediction on an unlabelled photo is unknown rather than wrong', () => {
  const f = prepareImageTrainingFeedback({ cases: [c('dev')], labels: [label(c('dev'), 'a', 'acceptable')] });
  const d = diagnoseExistingImageChoices(f, [{ activity_id: 'dev', model_selected_url: 'https://example.test/unseen.jpg' }]);
  assert.equal(d[0].previous_model_assessment, 'not_explicitly_labelled');
});
