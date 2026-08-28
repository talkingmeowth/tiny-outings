import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATEGORY_ILLUSTRATION_SELECTION_KIND,
  categoryIllustrationCandidate,
  categoryIllustrationFilename,
} from './categoryIllustrations.js';

test('matches the illustrated category images used by the main app', () => {
  assert.equal(categoryIllustrationFilename({ category: 'Parks & outdoor play' }), 'park-placeholder.svg');
  assert.equal(categoryIllustrationFilename({ category: 'Bookshops' }), 'bookshop-placeholder.svg');
  assert.equal(categoryIllustrationFilename({ category: 'Cafés & food' }), 'family-cafe-placeholder.svg');
  assert.equal(categoryIllustrationFilename({ category: 'Music & movement' }), 'family-outing-placeholder.svg');
});

test('builds a clearly identified selectable illustration candidate', () => {
  const candidate = categoryIllustrationCandidate({ category: 'Cafes & food' });
  assert.equal(candidate.selection_kind, CATEGORY_ILLUSTRATION_SELECTION_KIND);
  assert.equal(candidate.is_category_illustration, true);
  assert.match(candidate.image_url, /images\/family-cafe-placeholder\.svg$/);
  assert.equal(candidate.source_domain, 'Tiny Outings illustration');
});
