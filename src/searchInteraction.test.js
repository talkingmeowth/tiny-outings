import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldOpenSearchOnKey } from './searchInteraction.js';

test('opens directory search only when the keyboard submit key is pressed', () => {
  assert.equal(shouldOpenSearchOnKey('Enter'), true);
  assert.equal(shouldOpenSearchOnKey('Space'), false);
  assert.equal(shouldOpenSearchOnKey('Escape'), false);
});
