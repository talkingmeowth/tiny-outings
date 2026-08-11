import assert from 'node:assert/strict';
import test from 'node:test';
import { profileQrUrl, profileShareData } from './profileSharing.js';

test('profile share uses the same personal follow URL as the QR code', () => {
  const followUrl = profileQrUrl('Parent.Pal');
  const data = profileShareData({ user_name: 'Parent.Pal', display_name: 'Parent Pal' });

  assert.equal(followUrl, 'tinyoutings://follow/parent.pal');
  assert.equal(data.url, followUrl);
  assert.match(data.text, new RegExp(followUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(data.url, /onrender\.com/);
});
