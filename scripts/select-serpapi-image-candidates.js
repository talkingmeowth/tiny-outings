/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, RawImage } from '@huggingface/transformers';
import {
  chooseBestSerpApiCandidate,
  labelsForSerpApiImageAudit,
} from './lib/serpapi-image-confidence-policy.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(root, 'data', 'serpapi_image_candidate_selection.generated.json');
const modelId = process.env.TINY_OUTINGS_SERPAPI_IMAGE_MODEL || 'Xenova/clip-vit-base-patch32';
const reselect = process.argv.includes('--reselect');
const limitIndex = process.argv.indexOf('--limit');
const limit = limitIndex >= 0 ? Math.max(1, Number(process.argv[limitIndex + 1]) || 1) : 20;

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

async function fetchActivities() {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const url = new URL(`${supabaseUrl}/rest/v1/activities`);
    url.searchParams.set('select', 'activity_id,activity_name,address,category,website,organiser_website,serpapi_image_candidates,serpapi_image_candidates_fetched_at,serpapi_image_selected_at');
    url.searchParams.set('archive', 'eq.false');
    url.searchParams.set('public_listing_status', 'in.(draft,published)');
    url.searchParams.set('serpapi_image_candidates_fetched_at', 'not.is.null');
    url.searchParams.set('order', 'activity_id.asc');
    url.searchParams.set('limit', '1000');
    url.searchParams.set('offset', String(offset));
    const response = await fetch(url, { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } });
    if (!response.ok) throw new Error(`Could not load stored SerpAPI candidates: ${response.status}.`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function loadImage(candidate) {
  const urls = [candidate.original, candidate.thumbnail].filter(Boolean);
  let failure = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().startsWith('image/')) {
        throw new Error(`Image download returned ${response.status || 'an invalid'} response.`);
      }
      return RawImage.fromBlob(await response.blob());
    } catch (error) {
      failure = error;
    }
  }
  throw failure || new Error('Candidate does not have a usable image URL.');
}

async function persistSelections(selections) {
  if (!selections.length) return [];
  if (!supabaseUrl || !supabaseAnonKey || !jobSecret) {
    throw new Error('Missing Supabase configuration or TINY_OUTINGS_IMAGE_JOB_SECRET.');
  }
  const batches = [];
  for (let offset = 0; offset < selections.length; offset += 20) {
    const response = await fetch(`${supabaseUrl}/functions/v1/cafe-image-importer`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
        'x-tiny-outings-image-job-token': jobSecret,
      },
      body: JSON.stringify({ selections: selections.slice(offset, offset + 20) }),
      signal: AbortSignal.timeout(150000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Candidate selector returned ${response.status}.`);
    batches.push(...(payload.results || []));
  }
  return batches;
}

function writeAudit(rows, total, saved) {
  const summary = rows.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1;
    return counts;
  }, { selected: 0, rejected: 0, failed: 0, pending: 0 });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    model: modelId,
    candidate_discovery_calls: 0,
    total_stored_candidate_records: total,
    reviewed: rows.length,
    persisted: saved,
    summary,
    rows,
  }, null, 2) + '\n');
}

async function main() {
  const activities = await fetchActivities();
  const eligible = activities.filter((activity) => {
    const candidates = Array.isArray(activity.serpapi_image_candidates) ? activity.serpapi_image_candidates : [];
    if (!candidates.length) return false;
    if (reselect) return true;
    return !activity.serpapi_image_selected_at;
  });
  // A persisted decision sets selected_at and drops out on the next run. A
  // failed Storage copy remains eligible, so it can be retried without a new
  // paid search or a stale local checkpoint hiding it.
  const pending = eligible.slice(0, limit);
  if (!pending.length) {
    writeAudit([], eligible.length, []);
    console.log(`No unselected SerpAPI candidate sets are pending. ${eligible.length} stored sets are available for --reselect without new API calls.`);
    return;
  }

  console.log(`Loading local vision model ${modelId} to select from ${pending.length} stored candidate sets. No SerpAPI calls will be made.`);
  const classifier = await pipeline('zero-shot-image-classification', modelId, {
    cache_dir: join(root, 'node_modules', '.cache', 'tiny-outings-vision'),
    dtype: 'q4',
  });
  const rows = [];
  const selections = [];
  for (const activity of pending) {
    const candidates = activity.serpapi_image_candidates;
    const labels = labelsForSerpApiImageAudit(activity);
    const visualResults = [];
    let failedCandidates = 0;
    for (const candidate of candidates) {
      try {
        const image = await loadImage(candidate);
        visualResults.push(await classifier(image, labels, { hypothesis_template: 'This image shows {}.' }));
      } catch {
        failedCandidates += 1;
        visualResults.push([]);
      }
    }
    if (failedCandidates === candidates.length) {
      rows.push({
        activity_id: activity.activity_id,
        activity_name: activity.activity_name,
        candidates_fetched_at: activity.serpapi_image_candidates_fetched_at,
        status: 'failed',
        reason: 'Every stored candidate image failed to download for local visual assessment.',
      });
      continue;
    }
    const selected = chooseBestSerpApiCandidate(activity, candidates, visualResults);
    if (!selected.selection) {
      const reason = 'No stored candidate met the high-confidence visual and provenance policy.';
      rows.push({
        activity_id: activity.activity_id,
        activity_name: activity.activity_name,
        candidates_fetched_at: activity.serpapi_image_candidates_fetched_at,
        status: 'rejected',
        reason,
        candidate_count: candidates.length,
        failed_candidates: failedCandidates,
      });
      selections.push({
        activity_id: activity.activity_id,
        candidate_index: null,
        selection_reason: reason,
        selection_confidence: null,
        clear_selected_image: true,
      });
      continue;
    }
    const { index, assessment } = selected.selection;
    rows.push({
      activity_id: activity.activity_id,
      activity_name: activity.activity_name,
      candidates_fetched_at: activity.serpapi_image_candidates_fetched_at,
      status: 'selected',
      candidate_index: index,
      candidate_count: candidates.length,
      failed_candidates: failedCandidates,
      reason: assessment.reason,
      confidence: assessment.confidence,
      visual_preference: assessment.visual.preferred_label,
      source_official: assessment.provenance.official,
    });
    selections.push({
      activity_id: activity.activity_id,
      candidate_index: index,
      selection_reason: assessment.reason,
      selection_confidence: assessment.confidence,
    });
  }
  const saved = await persistSelections(selections);
  writeAudit(rows, eligible.length, saved);
  console.log(`Selected ${rows.filter((row) => row.status === 'selected').length}; rejected ${rows.filter((row) => row.status === 'rejected').length}; failed ${rows.filter((row) => row.status === 'failed').length}. No SerpAPI calls were made.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
