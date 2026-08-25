import assert from 'node:assert/strict';
import test from 'node:test';
import { invokeFunctionWithRetry, isRetryableFunctionTransportError } from './functionRetry.js';

test('recognises Supabase Edge Function transport failures', () => {
  assert.equal(isRetryableFunctionTransportError({ name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' }), true);
  assert.equal(isRetryableFunctionTransportError({ message: 'The selected image is too small.' }), false);
});

test('retries a transient function transport failure and returns the successful response', async () => {
  let calls = 0;
  const waits = [];
  const response = await invokeFunctionWithRetry(async () => {
    calls += 1;
    if (calls < 3) return { data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' } };
    return { data: { status: 'selected' }, error: null };
  }, { wait: async (milliseconds) => waits.push(milliseconds) });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [500, 1500]);
  assert.equal(response.data.status, 'selected');
});

test('does not retry a backend validation response', async () => {
  let calls = 0;
  const response = await invokeFunctionWithRetry(async () => {
    calls += 1;
    return { data: { error: 'The selected image is too small.' }, error: null };
  }, { wait: async () => {} });
  assert.equal(calls, 1);
  assert.equal(response.data.error, 'The selected image is too small.');
});
