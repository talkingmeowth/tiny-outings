import assert from 'node:assert/strict';
import test from 'node:test';
import { edgeFunctionErrorMessage } from './functionErrors.js';

test('shows the useful error returned by an edge function', async () => {
  const message = await edgeFunctionErrorMessage({
    error: {
      message: 'Edge Function returned a non-2xx status code',
      context: { json: async () => ({ error: 'The selected image could not be downloaded at sufficient resolution.' }) },
    },
  }, 'Image review failed.');
  assert.equal(message, 'The selected image could not be downloaded at sufficient resolution.');
});

test('falls back to the client error when no response body is available', async () => {
  const message = await edgeFunctionErrorMessage({ error: { message: 'Network request failed' } }, 'Image review failed.');
  assert.equal(message, 'Network request failed');
});
