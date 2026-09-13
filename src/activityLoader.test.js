import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVITY_PAGE_SIZE,
  isTransientActivityLoadError,
  loadActivityPageWithRetries,
} from './activityLoader.js';

test('keeps activity pages small enough for the production PostgREST query', () => {
  assert.ok(ACTIVITY_PAGE_SIZE <= 250);
});

test('retries a transient database timeout and returns the successful page', async () => {
  let calls = 0;
  const delays = [];
  const response = await loadActivityPageWithRetries(
    async () => {
      calls += 1;
      return calls === 1
        ? { data: null, error: { message: 'canceling statement due to statement timeout' }, status: 500 }
        : { data: [{ activity_id: 'activity-1' }], error: null, status: 200 };
    },
    { wait: async (delay) => delays.push(delay) },
  );

  assert.equal(calls, 2);
  assert.deepEqual(delays, [400]);
  assert.equal(response.error, null);
  assert.equal(response.data[0].activity_id, 'activity-1');
});

test('does not retry a permanent activity-query error', async () => {
  let calls = 0;
  const response = await loadActivityPageWithRetries(
    async () => {
      calls += 1;
      return { data: null, error: { message: 'column does not exist' }, status: 400 };
    },
    { wait: async () => {} },
  );

  assert.equal(calls, 1);
  assert.equal(response.status, 400);
  assert.equal(isTransientActivityLoadError(response.error, response.status), false);
});
