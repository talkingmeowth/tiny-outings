import assert from 'node:assert/strict';
import test from 'node:test';
import { hasBlockedAssetTerms } from './candidate-policy.js';

test('allows an administrator to select a genuine Instagram-hosted activity photo', () => {
  assert.equal(hasBlockedAssetTerms(
    'https://lookaside.instagram.com/seo/google_widget/crawler/?media_id=3719900063645598087',
    'https://www.instagram.com/asmallplacelondon/',
    'A Small Place (@asmallplacelondon) · London',
  ), false);
});

test('still rejects logos, icons, placeholders, and tracking assets', () => {
  assert.equal(hasBlockedAssetTerms('https://venue.test/assets/logo.png'), true);
  assert.equal(hasBlockedAssetTerms('https://venue.test/favicon.ico'), true);
  assert.equal(hasBlockedAssetTerms('https://venue.test/placeholder.jpg'), true);
  assert.equal(hasBlockedAssetTerms('https://venue.test/tracking-pixel.gif'), true);
});
