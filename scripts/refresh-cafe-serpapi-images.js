/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scope = process.argv.includes('--scope') && process.argv[process.argv.indexOf('--scope') + 1] === 'cafes'
  ? 'cafes'
  : 'all';
const deprecatedRefreshRequested = process.argv.includes('--refresh-existing')
  || process.argv.includes('--replacement-mode')
  || process.argv.includes('--force-venue-refresh');
const activityIdsFile = process.argv.includes('--activity-ids-file')
  ? process.argv[process.argv.indexOf('--activity-ids-file') + 1] || null
  : null;
const createdAfter = process.argv.includes('--created-after')
  ? process.argv[process.argv.indexOf('--created-after') + 1] || null
  : null;
const outputPath = join(root, 'data', scope === 'cafes'
  ? 'cafe_serpapi_image_refresh.generated.json'
  : activityIdsFile
    ? 'scraped_image_serpapi_refresh.generated.json'
    : 'activity_serpapi_image_refresh.generated.json');
const batchSizeIndex = process.argv.indexOf('--batch-size');
const batchSize = batchSizeIndex >= 0
  ? Math.min(20, Math.max(1, Number(process.argv[batchSizeIndex + 1]) || 20))
  : 20;
const startCursor = process.argv.includes('--cursor')
  ? process.argv[process.argv.indexOf('--cursor') + 1] || null
  : null;
const maxBatches = process.argv.includes('--max-batches')
  ? Math.max(1, Number(process.argv[process.argv.indexOf('--max-batches') + 1]) || 1)
  : Number.POSITIVE_INFINITY;

function previousCursor() {
  if (startCursor || process.argv.includes('--start')) return startCursor;
  try {
    const previous = JSON.parse(readFileSync(outputPath, 'utf8'));
    return previous.resume_cursor || null;
  } catch {
    return null;
  }
}

function explicitActivityIds() {
  if (!activityIdsFile) return [];
  try {
    const raw = JSON.parse(readFileSync(join(root, activityIdsFile), 'utf8'));
    const values = Array.isArray(raw) ? raw : raw.activity_ids;
    const sourceGeneratedAt = Array.isArray(raw) ? null : raw.generated_at || null;
    if (!Array.isArray(values)) throw new Error('Expected an activity_ids array.');
    const requested = [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))];
    try {
      const previous = JSON.parse(readFileSync(outputPath, 'utf8'));
      const sameJob = previous.scope === scope
        && previous.activity_ids_generated_at === sourceGeneratedAt;
      if (sameJob && Array.isArray(previous.pending_activity_ids)) {
        return [...new Set(previous.pending_activity_ids.filter((value) => typeof value === 'string' && value.trim()))];
      }
    } catch {
      // No compatible checkpoint yet, so start with the complete requested set.
    }
    return requested;
  } catch (error) {
    throw new Error(`Could not read ${activityIdsFile}: ${error.message}`);
  }
}

function readDotEnv(name) {
  try {
    return Object.fromEntries(readFileSync(join(root, name), 'utf8').replace(/^\uFEFF/, '')
      .split(/\r?\n/).filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
      }));
  } catch {
    return {};
  }
}

const localEnv = readDotEnv('.env.local');
const supabaseUrl = process.env.VITE_SUPABASE_URL || localEnv.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || localEnv.VITE_SUPABASE_ANON_KEY;
const jobSecret = process.env.TINY_OUTINGS_IMAGE_JOB_SECRET || localEnv.TINY_OUTINGS_IMAGE_JOB_SECRET;

async function invoke(cursor, activityIds = []) {
  // Do not retry automatically. A timeout after SerpAPI receives a request is
  // ambiguous, and a retry could spend a second paid search for one listing.
  const response = await fetch(`${supabaseUrl}/functions/v1/cafe-image-importer`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
      'x-tiny-outings-image-job-token': jobSecret,
    },
    body: JSON.stringify({
      cursor,
      batch_size: batchSize,
      scope,
      activity_ids: activityIds,
      ...(createdAfter ? { created_after: createdAfter } : {}),
    }),
    signal: AbortSignal.timeout(150000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `SerpAPI candidate discovery returned ${response.status}.`);
  return payload;
}

async function main() {
  if (!supabaseUrl || !supabaseAnonKey || !jobSecret) {
    throw new Error('Missing Supabase configuration or TINY_OUTINGS_IMAGE_JOB_SECRET.');
  }
  if (deprecatedRefreshRequested) {
    console.log('Ignoring legacy refresh flags. Existing candidate sets are never re-searched; use select-serpapi-image-candidates.js --reselect to improve a saved choice locally.');
  }
  if (createdAfter && !Number.isFinite(Date.parse(createdAfter))) {
    throw new Error('--created-after must be a valid timestamp.');
  }

  const batches = [];
  const requestedIds = explicitActivityIds();
  // The Edge Function selects only records without a saved candidate set.
  // Persisting the cursor prevents a later run from re-scanning completed IDs.
  let cursor = requestedIds.length ? null : previousCursor();
  let stoppedForRateLimit = false;
  let resumeCursor = cursor;
  const pendingActivityIds = [];
  if (requestedIds.length) {
    for (let offset = 0; offset < requestedIds.length && batches.length < maxBatches; offset += batchSize) {
      const activityIds = requestedIds.slice(offset, offset + batchSize);
      const batch = await invoke(null, activityIds);
      batches.push(batch);
      console.log(`Targeted image batch ${batches.length}: ${batch.candidates_stored || 0}/${batch.processed || 0} candidate sets stored.`);
      const rateLimitedIndex = (batch.results || []).findIndex((result) => result.status === 'rate-limited');
      if (rateLimitedIndex >= 0) {
        stoppedForRateLimit = true;
        pendingActivityIds.push(...activityIds.slice(rateLimitedIndex), ...requestedIds.slice(offset + batchSize));
        console.log(`SerpAPI rate limit reached. ${pendingActivityIds.length} activity IDs remain.`);
        break;
      }
    }
    if (!stoppedForRateLimit && batches.length >= maxBatches) pendingActivityIds.push(...requestedIds.slice(batches.length * batchSize));
  } else {
    do {
      const requestCursor = cursor;
      const batch = await invoke(cursor);
      batches.push(batch);
      cursor = batch.next_cursor || null;
      console.log(`${scope === 'cafes' ? 'Cafe' : 'Activity'} image batch ${batches.length}: ${batch.candidates_stored || 0}/${batch.processed || 0} candidate sets stored. Next cursor: ${cursor || 'complete'}`);
      const rateLimitedIndex = (batch.results || []).findIndex((result) => result.status === 'rate-limited');
      if (rateLimitedIndex >= 0) {
        stoppedForRateLimit = true;
        // Resume immediately before the first unprocessed record. Without this,
        // a partial rate-limited batch would spend searches on already-saved rows.
        resumeCursor = batch.results[rateLimitedIndex - 1]?.activity_id || requestCursor;
        cursor = resumeCursor;
        console.log(`SerpAPI rate limit reached. Resume from: ${resumeCursor || 'start'}`);
        break;
      }
      if (cursor) await new Promise((resolve) => setTimeout(resolve, 750));
    } while (cursor && batches.length < maxBatches);
  }

  const results = batches.flatMap((batch) => batch.results || []);
  const summary = results.reduce((counts, result) => {
    counts[result.status] = (counts[result.status] || 0) + 1;
    return counts;
  }, {});
  const audit = {
    generated_at: new Date().toISOString(),
    scope,
    paid_search_policy: 'one successful candidate discovery per activity',
    batches: batches.length,
    stopped_for_rate_limit: stoppedForRateLimit,
    resume_cursor: stoppedForRateLimit ? resumeCursor : cursor,
    requested_activity_ids: requestedIds.length || undefined,
    activity_ids_file: activityIdsFile || undefined,
    activity_ids_generated_at: activityIdsFile
      ? JSON.parse(readFileSync(join(root, activityIdsFile), 'utf8')).generated_at || null
      : undefined,
    created_after: createdAfter || undefined,
    pending_activity_ids: pendingActivityIds,
    summary,
    results,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(audit, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
