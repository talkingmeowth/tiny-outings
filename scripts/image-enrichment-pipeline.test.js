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
  assert.match(pipeline, /'--scope', 'all-unreviewed', '--created-after', runStartedAt, '--visual-assessment', '--apply'/);
  assert.doesNotMatch(pipeline, /'--search-missing'/);
});

test('website and organiser discovery stores every unique eligible candidate before model inference', () => {
  const downloader = read('supabase/functions/activity-website-image-downloader/index.ts');
  const ranker = read('scripts/lib/tagged-image-ranker.js');
  assert.doesNotMatch(downloader, /maxStoredCandidates/);
  assert.doesNotMatch(downloader, /\.slice\(0,\s*maxStoredCandidates\)/);
  assert.match(ranker, /crossSourceCandidateSet\(activity, maximumCandidates = Number\.POSITIVE_INFINITY\)/);
});

test('new-listing model inference is scoped to the current import and accepts every quality-gated winner', () => {
  const pipeline = read('scripts/tiny-outings-update.js');
  const runner = read('scripts/automate-tagged-image-review.js');
  const endpoint = read('supabase/functions/activity-image-auto-review/index.ts');
  assert.match(pipeline, /'--created-after', runStartedAt/);
  assert.match(runner, /created_after: createdAfter/);
  assert.match(endpoint, /query = query\.gte\('created_at', createdAfter\)/);
  assert.doesNotMatch(endpoint, /Number\(proposal\.confidence\) < 0\.7/);
});
