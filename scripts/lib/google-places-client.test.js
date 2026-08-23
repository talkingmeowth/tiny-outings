import assert from 'node:assert/strict';
import test from 'node:test';
import { createGooglePlacesClient } from './google-places-client.js';

function response(status, body = {}, retryAfter = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => retryAfter },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test('adds the API key header while preserving importer field masks', async () => {
  const calls = [];
  const client = createGooglePlacesClient({
    minimumIntervalMs: 0,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, { places: [] });
    },
  });

  const body = await client('https://places.googleapis.com/v1/places:searchText', 'test-key', {
    headers: { 'X-Goog-FieldMask': 'places.id' },
  });

  assert.deepEqual(body, { places: [] });
  assert.equal(calls[0].options.headers['X-Goog-Api-Key'], 'test-key');
  assert.equal(calls[0].options.headers['X-Goog-FieldMask'], 'places.id');
});

test('retries a quota response and honours its retry-after value', async () => {
  let currentTime = 0;
  const waits = [];
  let attempts = 0;
  const client = createGooglePlacesClient({
    minimumIntervalMs: 0,
    maxRetries: 2,
    now: () => currentTime,
    waitImpl: async (milliseconds) => {
      waits.push(milliseconds);
      currentTime += milliseconds;
    },
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1 ? response(429, { error: 'quota' }, '2') : response(200, { places: [{ id: 'ok' }] });
    },
  });

  const body = await client('https://places.googleapis.com/v1/places:searchText', 'test-key');
  assert.deepEqual(body, { places: [{ id: 'ok' }] });
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [2000]);
});

test('fails fast for a non-retryable Google Places response', async () => {
  let attempts = 0;
  const client = createGooglePlacesClient({
    minimumIntervalMs: 0,
    fetchImpl: async () => {
      attempts += 1;
      return response(400, { error: 'invalid request' });
    },
  });

  await assert.rejects(client('https://places.googleapis.com/v1/places:searchText', 'test-key'), /Google Places returned 400/);
  assert.equal(attempts, 1);
});

test('never attempts a Google request without a configured API key', async () => {
  const client = createGooglePlacesClient({ fetchImpl: async () => response(200) });
  await assert.rejects(client('https://places.googleapis.com/v1/places:searchText', ''), /Missing GOOGLE_PLACES_API_KEY/);
});
