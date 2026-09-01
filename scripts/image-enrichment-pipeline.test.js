import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

test('stores a complete SerpAPI response behind a durable one-attempt claim', () => {
  const importer = read('supabase/functions/cafe-image-importer/index.ts');
  assert.match(importer, /serpapi_image_search_attempted_at/);
  assert.match(importer, /\.is\('serpapi_image_search_attempted_at', null\)/);
  assert.match(importer, /serpapi_image_search_metadata: discovery\.metadata/);
  assert.match(importer, /Paid SerpAPI repeats are disabled/);
  assert.doesNotMatch(importer, /maxStoredCandidates/);
  assert.doesNotMatch(importer, /rawCandidates[\s\S]{0,500}\.slice\(0,/);
});

test('desktop review reuses canonical candidates and only limits the displayed gallery', () => {
  const admin = read('supabase/functions/image-review-admin/index.ts');
  assert.match(admin, /completeFromStored/);
  assert.match(admin, /Stored SerpAPI candidates - reused without a paid call/);
  assert.match(admin, /serpapi_image_search_metadata: redactSerpApiSecrets\(searchMetadata\)/);
  assert.match(admin, /value\.slice\(0, 20\)/);
  assert.doesNotMatch(admin, /body\.images_results\) \? body\.images_results\.slice\(0, 20\)/);
});

test('the importer pipeline reruns every selector from stored candidates', () => {
  const pipeline = read('scripts/tiny-outings-update.js');
  for (const job of [
    'discover-website-image-candidates',
    'select-stored-website-images',
    'serpapi-image-enrichment',
    'select-stored-serpapi-images',
    'apply-repeatable-model-image-review',
  ]) assert.match(pipeline, new RegExp(`name: '${job}'`));
  assert.match(pipeline, /'--scope', 'all-unreviewed', '--visual-assessment', '--apply'/);
  assert.doesNotMatch(pipeline, /'--search-missing'/);
});
