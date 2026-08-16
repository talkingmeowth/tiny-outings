import assert from 'node:assert/strict';
import test from 'node:test';
import { activityCoordinates, resolveActivityCoordinates } from './activityLocation.js';

test('keeps valid activity coordinates without requesting a geocode', async () => {
  let calls = 0;
  const result = await resolveActivityCoordinates(
    { lat: '51.4965109', long: '-0.1760019' },
    async () => { calls += 1; throw new Error('should not be called'); },
  );

  assert.deepEqual(result, { lat: 51.4965109, long: -0.1760019 });
  assert.equal(calls, 0);
});

test('resolves missing coordinates through the CORS-enabled London geocoder', async () => {
  let requestedUrl = '';
  const result = await resolveActivityCoordinates(
    { activity_name: 'Adventure Babies', address: 'Natural History Museum, London' },
    async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        json: async () => ({
          features: [{ geometry: { coordinates: ['-0.1760019', '51.4965109'] } }],
        }),
      };
    },
  );

  assert.match(requestedUrl, /photon\.komoot\.io/);
  assert.match(requestedUrl, /bbox=/);
  assert.deepEqual(result, { lat: 51.4965109, long: -0.1760019 });
});

test('rejects incomplete coordinates', () => {
  assert.equal(activityCoordinates({ lat: '51.5', long: '' }), null);
  assert.equal(activityCoordinates({ lat: '91', long: '0' }), null);
});
