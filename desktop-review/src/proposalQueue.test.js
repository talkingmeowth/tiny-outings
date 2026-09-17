import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeProposalPage } from './proposalQueue.js';

test('overlapping queue pages show one row per activity with its newest decision', () => {
  const first = [{ activity_id: 'myddelton', decision: 'pending' }, { activity_id: 'other', decision: 'pending' }];
  const second = [{ activity_id: 'myddelton', decision: 'approved' }, { activity_id: 'third', decision: 'pending' }];
  assert.deepEqual(mergeProposalPage(first, second), [
    { activity_id: 'myddelton', decision: 'approved' },
    { activity_id: 'other', decision: 'pending' },
    { activity_id: 'third', decision: 'pending' },
  ]);
});
