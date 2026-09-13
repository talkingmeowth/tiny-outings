import assert from 'node:assert/strict';
import test from 'node:test';
import { isDirectorySearchResult } from './activityDirectory.js';

const listing = (overrides = {}) => ({
  activity_id: 'outside-selected-week',
  activity_name: 'A Message to the Future',
  public_listing_status: 'published',
  archive: false,
  activity_date: '2026-10-17',
  ...overrides,
});

test('directory name search includes a published listing regardless of the selected planning week', () => {
  assert.equal(isDirectorySearchResult(listing(), 'message future'), true);
});

test('directory name search excludes archived, draft and locally hidden listings', () => {
  assert.equal(isDirectorySearchResult(listing({ archive: true }), 'message'), false);
  assert.equal(isDirectorySearchResult(listing({ public_listing_status: 'draft' }), 'message'), false);
  assert.equal(isDirectorySearchResult(listing(), 'message', new Set(['outside-selected-week'])), false);
});

test('directory name search normalises case and accents', () => {
  assert.equal(isDirectorySearchResult(listing({ activity_name: 'Caf\u00e9 B\u00e9b\u00e9' }), 'CAFE BEBE'), true);
});
