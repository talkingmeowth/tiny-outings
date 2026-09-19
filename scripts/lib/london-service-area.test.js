import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isWithinGreaterLondon } from './london-service-area.js';

test('accepts London venues and rejects known imported outliers', () => {
  assert.equal(isWithinGreaterLondon(51.374999, -0.093764), true); // Croydon
  assert.equal(isWithinGreaterLondon(51.560749, -0.280148), true); // Wembley
  assert.equal(isWithinGreaterLondon(53.475149, -2.227668), false); // Manchester
  assert.equal(isWithinGreaterLondon(52.4755, -1.88103), false); // Birmingham
  assert.equal(isWithinGreaterLondon(51.338046, -0.742373), false); // Camberley
  assert.equal(isWithinGreaterLondon(51.768032, -3.709365), false); // Neath
  assert.equal(isWithinGreaterLondon(null, null), false);
});
