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

test('the importer prepares one chat review across sources without competing selectors', () => {
  const pipeline = read('scripts/tiny-outings-update.js');
  for (const job of [
    'discover-website-image-candidates',
    'serpapi-image-enrichment',
    'prepare-single-chat-image-selection',
  ]) assert.match(pipeline, new RegExp(`name: '${job}'`));
  assert.match(pipeline, /image_selection_status: skipImages \? 'skipped' : 'awaiting_codex_chat_review'/);
  assert.doesNotMatch(pipeline, /'--search-missing'/);
  assert.ok(pipeline.indexOf("name: 'serpapi-image-enrichment'") < pipeline.indexOf("name: 'prepare-single-chat-image-selection'"));
  assert.doesNotMatch(pipeline, /script: '(automate-tagged-image-review|select-stored-serpapi-images|select-website-image-candidates)\.js'/);
  assert.match(read('scripts/download-activity-website-images.js'), /model_selected_model !== 'activity-family-inheritance'/);
  assert.match(read('supabase/functions/cafe-image-importer/index.ts'), /model_selected_model\.neq\.activity-family-inheritance/);
  assert.match(read('supabase/functions/activity-image-auto-review/index.ts'), /model_selected_model\.neq\.activity-family-inheritance/);
});

test('Codex review queues expose activity and Google Places context to the LLM', () => {
  const migration = read('supabase/migrations/20260913180000_add_google_context_to_codex_image_queues.sql');
  for (const field of ['description', 'google_summary', 'google_primary_type', 'google_place_id', 'google_place_uri', 'google_link']) {
    assert.match(migration, new RegExp(`a\\.${field}`));
  }
  assert.match(read('scripts/codex-image-review.js'), /Google Places summary\/type/);
});

test('website and organiser discovery stores every unique eligible candidate before model inference', () => {
  const downloader = read('supabase/functions/activity-website-image-downloader/index.ts');
  const runner = read('scripts/download-activity-website-images.js');
  const ranker = read('scripts/lib/tagged-image-ranker.js');
  assert.doesNotMatch(downloader, /maxStoredCandidates/);
  assert.doesNotMatch(downloader, /\.slice\(0,\s*maxStoredCandidates\)/);
  assert.match(ranker, /crossSourceCandidateSet\(activity, maximumCandidates = Number\.POSITIVE_INFINITY\)/);
  assert.match(runner, /return !activity\.website_image_candidates_fetched_at/);
});

test('new-listing model inference is scoped to the current import and accepts every quality-gated winner', () => {
  const pipeline = read('scripts/tiny-outings-update.js');
  const runner = read('scripts/automate-tagged-image-review.js');
  const endpoint = read('supabase/functions/activity-image-auto-review/index.ts');
  assert.match(pipeline, /'--created-after', runStartedAt/);
  assert.match(runner, /created_after: createdAfter/);
  assert.match(read('scripts/select-serpapi-image-candidates.js'), /created_at >= '\$\{createdAfter/);
  assert.match(endpoint, /query = query\.gte\('created_at', createdAfter\)/);
  assert.match(runner, /allowVisualFallback: true/);
  assert.match(endpoint, /automaticImageDisplayMinimumConfidence = 0\.5/);
  assert.doesNotMatch(endpoint, /Number\(proposal\.confidence\) < 0\.7/);
});

test('importer category changes cannot retain a disallowed Wikimedia image', () => {
  const importer = read('scripts/import-timeout-london-kids.js');
  assert.match(importer, /wikimedia_image_url = case/);
  assert.match(importer, /when excluded\.category in \('Parks & outdoor play', 'Museums & culture', 'Family activities'\)/);
  assert.match(importer, /else null/);
});

test('cross-source reviews and coverage scale beyond one provider page', () => {
  const migration = read('supabase/migrations/20260912223000_expand_automated_image_candidate_indices.sql');
  const coverage = read('scripts/audit-activity-image-coverage.js');
  assert.match(migration, /candidate_index is null or candidate_index >= 0/);
  assert.doesNotMatch(migration, /between 0 and/);
  assert.match(coverage, /jsonb_array_length\(coalesce\(serpapi_image_candidates/);
  assert.match(coverage, /serpapi_image_candidate_count/);
});
