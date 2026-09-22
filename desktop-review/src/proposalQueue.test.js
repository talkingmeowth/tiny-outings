import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeProposalPage, remainingProposalPageOffsets } from './proposalQueue.js';

test('overlapping queue pages show one row per activity with its newest decision', () => {
  const first = [{ activity_id: 'myddelton', decision: 'pending' }, { activity_id: 'other', decision: 'pending' }];
  const second = [{ activity_id: 'myddelton', decision: 'approved' }, { activity_id: 'third', decision: 'pending' }];
  assert.deepEqual(mergeProposalPage(first, second), [
    { activity_id: 'myddelton', decision: 'approved' },
    { activity_id: 'other', decision: 'pending' },
    { activity_id: 'third', decision: 'pending' },
  ]);
});

test('remaining queue pages can be loaded concurrently after the first page', () => {
  assert.deepEqual(remainingProposalPageOffsets(1366, 200), [200, 400, 600, 800, 1000, 1200]);
  assert.deepEqual(remainingProposalPageOffsets(200, null), []);
});
