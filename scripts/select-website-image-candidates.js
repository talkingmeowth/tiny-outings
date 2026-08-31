/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  rankStoredCandidates,
  trainTaggedImageRanker,
} from './lib/tagged-image-ranker.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(root, 'data', 'website_image_candidate_selection.generated.json');
const limitIndex = process.argv.indexOf('--limit');
const limit = limitIndex >= 0 ? Math.max(1, Number(process.argv[limitIndex + 1]) || 1) : Number.POSITIVE_INFINITY;
const workflowVersion = 'tagged-website-ranker-v1';
const retryFailed = process.argv.includes('--retry-failed');

function readDotEnv(path) {
  try {
    return Object.fromEntries(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
      .split(/\r?\n/).filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
      }));
  } catch {
    return {};
  }
}

const envPath = process.env.TINY_OUTINGS_ENV_FILE ? resolve(process.env.TINY_OUTINGS_ENV_FILE) : join(root, '.env.local');
const localEnv = readDotEnv(envPath);
const supabaseUrl = process.env.VITE_SUPABASE_URL || localEnv.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || localEnv.VITE_SUPABASE_ANON_KEY;
const jobSecret = process.env.TINY_OUTINGS_IMAGE_JOB_SECRET || localEnv.TINY_OUTINGS_IMAGE_JOB_SECRET;

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function callFunction(functionName, body, timeout = 180000) {
  if (!supabaseUrl || !supabaseAnonKey || !jobSecret) throw new Error('Missing Supabase image-job configuration.');
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
        method: 'POST',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
          'x-tiny-outings-image-job-token': jobSecret,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 4) {
        throw new Error(payload.error || `${functionName} returned ${response.status}.`);
      }
    } catch (error) {
      if (attempt === 4 || !['AbortError', 'TimeoutError', 'TypeError'].includes(error?.name)) throw error;
    }
    await wait(500 * (2 ** (attempt - 1)));
  }
  throw new Error(`${functionName} exhausted all retries.`);
}

async function loadTrainingRows() {
  const rows = [];
  for (let offset = 0; ; offset += 200) {
    const payload = await callFunction('activity-image-auto-review', {
      action: 'training_data',
      offset,
      page_size: 200,
    });
    rows.push(...(payload.rows || []));
    if (payload.next_offset == null) return rows;
  }
}

async function loadReviewQueue() {
  const rows = [];
  let cursor = null;
  do {
    const payload = await callFunction('activity-website-image-downloader', {
      review_queue: true,
      batch_size: 25,
      ...(cursor ? { cursor } : {}),
    });
    rows.push(...(payload.rows || []));
    cursor = payload.next_cursor;
    if (rows.length % 250 === 0 || cursor == null) console.log(`Website selector queue: loaded ${rows.length}${cursor ? '+' : ''} listings.`);
  } while (cursor && rows.length < limit);
  return rows.slice(0, Number.isFinite(limit) ? limit : undefined);
}

function loadFailedQueueFromLinkedDatabase(model) {
  const statement = `select activity_id,activity_name,address,postcode,borough,category,description,source_name,source_url,website,organiser_website,website_image_candidates as serpapi_image_candidates,website_image_candidates_fetched_at as serpapi_image_candidates_fetched_at,website_image_vision_candidate_index from public.activities where coalesce(archive, false) = false and public_listing_status in ('draft', 'published') and website_image_vision_model = '${model.name.replaceAll("'", "''")}' and website_image_vision_status = 'selection_download_failed' and website_image_vision_candidates_fetched_at = website_image_candidates_fetched_at order by activity_id asc;`;
  const escaped = statement.replaceAll('"', '\\"');
  const command = `npx${process.platform === 'win32' ? '.cmd' : ''} supabase db query --linked --output-format json "${escaped}"`;
  const output = execSync(command, {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 100 * 1024 * 1024,
  });
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Could not load failed website image selections.');
  const payload = JSON.parse(output.slice(start, end + 1));
  return (payload.rows || []).map((activity) => {
    const firstChoice = rankStoredCandidates(activity, model, { maximumCandidates: 80 });
    const latestCandidate = activity.serpapi_image_candidates?.[activity.website_image_vision_candidate_index];
    return {
      ...activity,
      automated_failed_image_urls: [...new Set([
        firstChoice?.candidate?.image_url,
        latestCandidate?.original || latestCandidate?.image_url,
      ].filter(Boolean))],
    };
  });
}

function selectionFor(activity, model) {
  const recommendation = rankStoredCandidates(activity, model, { maximumCandidates: 80 });
  const candidateSetFetchedAt = activity.serpapi_image_candidates_fetched_at;
  if (!recommendation) {
    return {
      activity_id: activity.activity_id,
      candidate_index: null,
      selection_reason: 'No official-website candidate passed the logo, icon, Wikimedia, and minimum-resolution policy.',
      selection_confidence: null,
      clear_selected_image: false,
      vision_review: {
        provider: 'codex',
        model: model.name,
        workflow_version: workflowVersion,
        candidate_set_fetched_at: candidateSetFetchedAt,
      },
    };
  }
  return {
    activity_id: activity.activity_id,
    candidate_index: recommendation.candidateIndex,
    selection_reason: recommendation.reason,
    selection_confidence: recommendation.confidence,
    vision_review: {
      provider: 'codex',
      model: model.name,
      workflow_version: workflowVersion,
      candidate_set_fetched_at: candidateSetFetchedAt,
    },
  };
}

async function sendSelectionBatches(selections, progressLabel) {
  const results = [];
  for (let offset = 0; offset < selections.length; offset += 20) {
    const payload = await callFunction('activity-website-image-downloader', {
      selections: selections.slice(offset, offset + 20),
    }, 240000);
    results.push(...(payload.results || []));
    const processed = Math.min(offset + 20, selections.length);
    console.log(`${progressLabel}: ${processed}/${selections.length} processed.`);
  }
  return results;
}

async function applySelections(queue, model, maximumAttempts = 3) {
  const activityById = new Map(queue.map((activity) => [activity.activity_id, activity]));
  const failuresById = new Map(queue.map((activity) => [activity.activity_id, [...(activity.automated_failed_image_urls || [])]]));
  const finalById = new Map();
  const attempts = [];
  let pending = queue.map((activity) => selectionFor(activity, model));

  for (let attempt = 1; attempt <= maximumAttempts && pending.length; attempt += 1) {
    const selectionsById = new Map(pending.map((selection) => [selection.activity_id, selection]));
    const results = await sendSelectionBatches(pending, `Website selection attempt ${attempt}`);
    attempts.push(...results.map((row) => ({ ...row, attempt })));
    const retryIds = [];
    for (const result of results) {
      const selection = selectionsById.get(result.activity_id);
      if (result.status !== 'selection-download-failed' || !selection || selection.candidate_index === null || attempt === maximumAttempts) {
        finalById.set(result.activity_id, result);
        continue;
      }
      const activity = activityById.get(result.activity_id);
      const failedCandidate = activity?.serpapi_image_candidates?.[selection.candidate_index];
      const failedUrl = failedCandidate?.original || failedCandidate?.image_url;
      const failedUrls = failuresById.get(result.activity_id) || [];
      if (failedUrl && !failedUrls.includes(failedUrl)) failedUrls.push(failedUrl);
      failuresById.set(result.activity_id, failedUrls);
      retryIds.push(result.activity_id);
    }
    pending = retryIds.map((activityId) => selectionFor({
      ...activityById.get(activityId),
      automated_failed_image_urls: failuresById.get(activityId) || [],
    }, model));
  }
  return { results: [...finalById.values()], attempts };
}

async function main() {
  const trainingRows = await loadTrainingRows();
  const model = trainTaggedImageRanker(trainingRows);
  console.log(`Website selector trained from ${model.trainingReviewCount} matched manual image choices.`);
  const queue = retryFailed ? loadFailedQueueFromLinkedDatabase(model) : await loadReviewQueue();
  if (!queue.length) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify({
      generated_at: new Date().toISOString(),
      model: model.name,
      model_version: model.version,
      workflow_version: workflowVersion,
      training_review_count: model.trainingReviewCount,
      queued: 0,
      summary: {},
      results: [],
      attempts: 0,
    }, null, 2)}\n`);
    console.log(retryFailed ? 'No failed website selections are pending fallback.' : 'No unreviewed populated website candidate sets are pending.');
    return;
  }
  console.log(`${retryFailed ? 'Failed website selections ready for fallback' : 'Website selections ready'}: ${queue.length}.`);
  const application = await applySelections(queue, model);
  const results = application.results;
  const summary = results.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1;
    return counts;
  }, {});
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    model: model.name,
    model_version: model.version,
    workflow_version: workflowVersion,
    training_review_count: model.trainingReviewCount,
    queued: queue.length,
    summary,
    results,
    attempts: application.attempts,
  }, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Website selector audit: ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
