/* global process */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FEATURE_NAMES,
  rankStoredCandidates,
  storedCandidateSet,
  trainTaggedImageRanker,
} from './lib/tagged-image-ranker.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const reportPath = join(root, 'data', 'automated_image_review_report.generated.json');
const apply = process.argv.includes('--apply');
const searchMissing = process.argv.includes('--search-missing');
const autoApply = process.argv.includes('--auto-apply');
const limitIndex = process.argv.indexOf('--limit');
const limit = limitIndex >= 0 ? Math.max(1, Number(process.argv[limitIndex + 1]) || 1) : Number.POSITIVE_INFINITY;
const concurrencyIndex = process.argv.indexOf('--search-concurrency');
const searchConcurrency = concurrencyIndex >= 0 ? Math.min(8, Math.max(1, Number(process.argv[concurrencyIndex + 1]) || 4)) : 4;

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

function assertConfiguration() {
  if (!supabaseUrl || !supabaseAnonKey || !jobSecret) {
    throw new Error('Missing VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, or TINY_OUTINGS_IMAGE_JOB_SECRET.');
  }
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function callFunction(functionName, body, timeout = 120000) {
  assertConfiguration();
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

async function loadPaged(action, pageSize) {
  const rows = [];
  let offset = 0;
  do {
    const payload = await callFunction('activity-image-auto-review', { action, offset, page_size: pageSize });
    rows.push(...(payload.rows || []));
    offset = payload.next_offset;
    console.log(`${action}: loaded ${rows.length}${offset == null ? '' : '+'} rows.`);
  } while (offset != null);
  return rows;
}

function candidateQuery(activity) {
  const name = String(activity.activity_name || '').trim();
  const address = String(activity.address || activity.borough || activity.postcode || 'London').trim();
  const nameText = name.toLowerCase();
  const usefulLocation = address.split(',').map((part) => part.trim()).find((part) => part && !/\d/.test(part) && !/^london$/i.test(part)) || address;
  return nameText.includes(usefulLocation.toLowerCase()) ? name : `${name} ${usefulLocation}`.trim();
}

async function searchCandidateSet(activity) {
  const payload = await callFunction('image-review-admin', {
    action: 'search',
    activity_id: activity.activity_id,
    query: candidateQuery(activity),
    request_variant: 'activity_location',
  }, 60000);
  return {
    ...activity,
    codex_image_candidates: payload.candidates || [],
    codex_image_search_query: payload.query,
    codex_image_searched_at: payload.searchedAt,
    codex_image_search_model: payload.source,
  };
}

async function fillMissingCandidateSets(targets) {
  const results = [...targets];
  const missingIndices = results.map((activity, index) => ({ activity, index }))
    .filter(({ activity }) => !storedCandidateSet(activity).length);
  if (!searchMissing || !missingIndices.length) return { targets: results, searched: 0, failed: [] };
  console.log(`Searching SerpAPI for ${missingIndices.length} targets without any stored candidate set.`);
  let nextIndex = 0;
  let completed = 0;
  const failed = [];
  async function worker() {
    while (nextIndex < missingIndices.length) {
      const task = missingIndices[nextIndex];
      nextIndex += 1;
      try {
        results[task.index] = await searchCandidateSet(task.activity);
      } catch (error) {
        failed.push({ activity_id: task.activity.activity_id, activity_name: task.activity.activity_name, error: error.message });
      }
      completed += 1;
      if (completed % 10 === 0 || completed === missingIndices.length) {
        console.log(`SerpAPI candidate searches: ${completed}/${missingIndices.length} complete (${failed.length} failed).`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(searchConcurrency, missingIndices.length) }, worker));
  return { targets: results, searched: missingIndices.length, failed };
}

function buildProposals(targets, model) {
  const proposals = [];
  const skipped = [];
  for (const activity of targets.slice(0, Number.isFinite(limit) ? limit : undefined)) {
    const recommendation = rankStoredCandidates(activity, model);
    if (!recommendation) {
      skipped.push({ activity_id: activity.activity_id, activity_name: activity.activity_name, reason: storedCandidateSet(activity).length ? 'no-eligible-candidate' : 'no-stored-candidates' });
      continue;
    }
    const usedLegacyCandidates = !Array.isArray(activity.codex_image_candidates) || !activity.codex_image_candidates.length;
    proposals.push({
      activity_id: activity.activity_id,
      source_queue: activity.automated_source_queue,
      candidate_index: recommendation.candidateIndex,
      candidate: recommendation.candidate,
      ...(usedLegacyCandidates ? { normalized_candidates: recommendation.normalizedCandidates } : {}),
      candidate_set_searched_at: activity.codex_image_searched_at || activity.serpapi_image_candidates_fetched_at || null,
      confidence: recommendation.confidence,
      reason: recommendation.reason,
      model_name: model.name,
      model_version: model.version,
      training_review_count: model.trainingReviewCount,
      model_metrics: model.metrics,
      feature_snapshot: recommendation.featureSnapshot,
    });
  }
  return { proposals, skipped };
}

async function storeProposals(proposals) {
  let stored = 0;
  for (let start = 0; start < proposals.length; start += 100) {
    const batch = proposals.slice(start, start + 100);
    const payload = await callFunction('activity-image-auto-review', { action: 'store_proposals', proposals: batch });
    stored += Number(payload.stored_count) || 0;
    console.log(`Automated review proposals stored: ${stored}/${proposals.length}.`);
  }
  return stored;
}

async function applyPendingImages(maximumPasses = 3) {
  let applied = 0;
  let preserved = 0;
  let failed = 0;
  for (let pass = 1; pass <= maximumPasses; pass += 1) {
    if (pass > 1) {
      const reset = await callFunction('activity-image-auto-review', { action: 'reset_apply_failures' });
      if (!reset.reset_count) break;
      console.log(`Retry pass ${pass}: reset ${reset.reset_count} failed applications.`);
    }
    let remaining = 1;
    let passProcessed = 0;
    while (remaining > 0) {
      const payload = await callFunction('activity-image-auto-review', { action: 'apply_pending', batch_size: 20 }, 180000);
      const rows = payload.rows || [];
      if (!rows.length) break;
      passProcessed += rows.length;
      applied += rows.filter((row) => ['auto-applied', 'already-applied'].includes(row.status)).length;
      preserved += rows.filter((row) => ['preserved-existing-review', 'archived'].includes(row.status)).length;
      failed += rows.filter((row) => row.status === 'failed').length;
      remaining = Number(payload.remaining_count) || 0;
      console.log(`Automatic image application pass ${pass}: ${passProcessed} processed, ${remaining} ready in this pass (${applied} applied, ${preserved} preserved, ${failed} failed attempts total).`);
    }
  }
  return { applied, preserved, failedAttempts: failed };
}

async function main() {
  if (autoApply) {
    const result = await applyPendingImages();
    console.log(`Automatic model selections applied: ${result.applied}; existing human choices preserved: ${result.preserved}; failed attempts: ${result.failedAttempts}.`);
    return;
  }
  const trainingRows = await loadPaged('training_data', 100);
  const model = trainTaggedImageRanker(trainingRows);
  console.log(`Model trained from ${model.trainingReviewCount} matched manual choices.`);
  console.log(`Held-out accuracy: top-1 ${model.metrics.top_1_accuracy}, top-3 ${model.metrics.top_3_recall}, MRR ${model.metrics.mean_reciprocal_rank}.`);
  const targets = await loadPaged('targets', 500);
  console.log(`Active missing/unsuitable targets: ${targets.length}.`);
  const candidateResult = await fillMissingCandidateSets(targets);
  const { proposals, skipped } = buildProposals(candidateResult.targets, model);
  console.log(`Proposals ready: ${proposals.length}; skipped: ${skipped.length}.`);
  const stored = apply ? await storeProposals(proposals) : 0;
  const automaticApplication = apply && stored ? await applyPendingImages() : null;
  const report = {
    generated_at: new Date().toISOString(),
    applied: apply,
    searched_missing_candidates: searchMissing,
    model: {
      name: model.name,
      version: model.version,
      training_review_count: model.trainingReviewCount,
      metrics: model.metrics,
      features: FEATURE_NAMES,
      weights: Object.fromEntries(FEATURE_NAMES.map((name, index) => [name, Number(model.weights[index].toFixed(6))])),
    },
    target_count: targets.length,
    serpapi_search_count: candidateResult.searched,
    serpapi_failure_count: candidateResult.failed.length,
    proposal_count: proposals.length,
    stored_count: stored,
    automatic_application: automaticApplication,
    skipped_counts: Object.fromEntries([...new Set(skipped.map((row) => row.reason))].map((reason) => [reason, skipped.filter((row) => row.reason === reason).length])),
    search_failures: candidateResult.failed,
    skipped,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${apply ? 'Applied' : 'Dry run complete'}; report written to ${reportPath}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
