/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scope = process.argv.includes('--scope') && process.argv[process.argv.indexOf('--scope') + 1] === 'cafes'
  ? 'cafes'
  : 'all';
const refreshExisting = process.argv.includes('--refresh-existing');
const outputPath = join(root, 'data', scope === 'cafes'
  ? 'cafe_serpapi_image_refresh.generated.json'
  : 'activity_serpapi_image_refresh.generated.json');
const batchSize = 20;
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

async function invoke(cursor) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/cafe-image-importer`, {
        method: 'POST',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
          'x-tiny-outings-image-job-token': jobSecret,
        },
        body: JSON.stringify({ cursor, batch_size: batchSize, scope, refresh_existing: refreshExisting }),
        signal: AbortSignal.timeout(150000),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
        throw new Error(payload.error || `Cafe image refresher returned ${response.status}.`);
      }
    } catch (error) {
      if (attempt === 3) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
  }
  throw new Error('Cafe image refresher did not return a result.');
}

async function main() {
  if (!supabaseUrl || !supabaseAnonKey || !jobSecret) {
    throw new Error('Missing Supabase configuration or TINY_OUTINGS_IMAGE_JOB_SECRET.');
  }

  const batches = [];
  // A one-batch run is the normal operational mode. Persisting the cursor means
  // the next run advances rather than repeating the same SerpAPI searches.
  // Unless --refresh-existing is used, the Edge Function selects only cards
  // with no stored image in the full display-priority hierarchy.
  let cursor = previousCursor();
  let stoppedForRateLimit = false;
  let resumeCursor = cursor;
  do {
    const requestCursor = cursor;
    const batch = await invoke(cursor);
    batches.push(batch);
    cursor = batch.next_cursor || null;
    console.log(`${scope === 'cafes' ? 'Cafe' : 'Activity'} image batch ${batches.length}: ${batch.updated || 0}/${batch.processed || 0} updated. Next cursor: ${cursor || 'complete'}`);
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

  const results = batches.flatMap((batch) => batch.results || []);
  const summary = results.reduce((counts, result) => {
    counts[result.status] = (counts[result.status] || 0) + 1;
    return counts;
  }, {});
  const audit = {
    generated_at: new Date().toISOString(),
    scope,
    refresh_existing: refreshExisting,
    batches: batches.length,
    stopped_for_rate_limit: stoppedForRateLimit,
    resume_cursor: stoppedForRateLimit ? resumeCursor : cursor,
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
