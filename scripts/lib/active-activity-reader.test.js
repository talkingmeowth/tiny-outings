import assert from 'node:assert/strict';
import test from 'node:test';
import { firstJsonObject } from './active-activity-reader.js';

test('extracts the database JSON result around CLI progress messages', () => {
  assert.deepEqual(firstJsonObject('Connecting...\n{"rows":[{"name":"A {safe} value"}],"message":"ok"}\nDone'), {
    rows: [{ name: 'A {safe} value' }], message: 'ok',
  });
});
