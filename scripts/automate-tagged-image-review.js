/* global process */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, RawImage } from '@huggingface/transformers';
import {
  crossSourceCandidateRanking,
  crossSourceCandidateSet,
  FEATURE_NAMES,
  rankCrossSourceCandidates,
  storedCandidateSet,
  trainTaggedImageRanker,
} from './lib/tagged-image-ranker.js';
import {
  assessSerpApiCandidate,
  labelsForSerpApiImageAudit,
} from './lib/serpapi-image-confidence-policy.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const reportPath = join(root, 'data', 'automated_image_review_report.generated.json');
const apply = process.argv.includes('--apply');
const searchMissing = process.argv.includes('--search-missing');
const autoApply = process.argv.includes('--auto-apply');
const scopeIndex = process.argv.indexOf('--scope');
const requestedScope = scopeIndex >= 0 ? process.argv[scopeIndex + 1] : null;
const scope = requestedScope === 'all-unreviewed'
  ? 'all_unreviewed'
  : requestedScope === 'all-active'
    ? 'all_active'
    : requestedScope === 'failed-applications' ? 'failed_applications' : 'targeted';
const limitIndex = process.argv.indexOf('--limit');
const limit = limitIndex >= 0 ? Math.max(1, Number(process.argv[limitIndex + 1]) || 1) : Number.POSITIVE_INFINITY;
const concurrencyIndex = process.argv.indexOf('--search-concurrency');
const searchConcurrency = concurrencyIndex >= 0 ? Math.min(8, Math.max(1, Number(process.argv[concurrencyIndex + 1]) || 4)) : 4;
const sourceNameIndex = process.argv.indexOf('--source-name');
const sourceName = sourceNameIndex >= 0 ? String(process.argv[sourceNameIndex + 1] || '').trim() : '';
const missingOnly = process.argv.includes('--missing-only');
const visualAssessmentEnabled = !process.argv.includes('--skip-visual-assessment');
const visualFinalistsIndex = process.argv.indexOf('--visual-finalists');
const visualFinalists = visualFinalistsIndex >= 0 ? Math.min(6, Math.max(1, Number(process.argv[visualFinalistsIndex + 1]) || 4)) : 4;
const visionModelId = process.env.TINY_OUTINGS_SERPAPI_IMAGE_MODEL || 'Xenova/clip-vit-base-patch32';

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
    const payload = await callFunction('activity-image-auto-review', {
      action,
      offset,
      page_size: pageSize,
      scope,
      ...(action === 'targets' && sourceName ? { source_name: sourceName } : {}),
      ...(action === 'targets' && missingOnly ? { missing_only: true } : {}),
    });
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

function secureUrl(value) {
  return String(value || '').trim().replace(/^http:\/\//i, 'https://');
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

async function loadVisualImage(candidate) {
  let lastError = null;
  for (const url of [...new Set([candidate.image_url, candidate.thumbnail_url].filter(Boolean))]) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().startsWith('image/')) {
        throw new Error(`Image download returned ${response.status || 'an invalid response'}.`);
      }
      const image = await RawImage.fromBlob(await response.blob());
      if (Math.min(Number(image.width) || 0, Number(image.height) || 0) < 300) {
        throw new Error('Image is below the minimum visual-review resolution.');
      }
      return image;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Candidate image could not be loaded.');
}

function policyCandidate(candidate) {
  return {
    original: candidate.image_url,
    thumbnail: candidate.thumbnail_url,
    link: candidate.source_page_url,
    source: candidate.source_domain,
    title: candidate.title,
    original_width: candidate.width,
    original_height: candidate.height,
  };
}

function retainedVisualConfidence(assessment) {
  const accepted = Number(assessment?.visual?.accepted) || 0;
  const rejected = Number(assessment?.visual?.rejected) || 0;
  const margin = accepted - rejected;
  return Number(clamp(0.72 + ((margin - 0.14) * 0.55) + (assessment?.provenance?.official ? 0.05 : 0), 0.7, 0.97).toFixed(4));
}

async function addVisualAssessments(targets, model) {
  const prepared = targets.map((activity) => ({
    activity,
    finalists: crossSourceCandidateRanking(activity, model).slice(0, visualFinalists),
    assessments: new Map(),
  }));
  const pending = [];
  for (const entry of prepared) {
    for (const row of entry.finalists) {
      const candidate = row.candidate;
      const key = secureUrl(candidate.image_url);
      if (candidate.visual_status === 'approved') {
        entry.assessments.set(key, {
          visual_status: 'approved',
          visual_reason: candidate.visual_reason || 'This exact image already passed a stored visual or audit review.',
          visual_confidence: Number(candidate.visual_confidence) || 0.9,
        });
      } else {
        pending.push({ entry, candidate, key });
      }
    }
  }
  if (pending.length && visualAssessmentEnabled) {
    console.log(`Loading local vision model ${visionModelId} for ${pending.length} cross-source finalists. No image-search API calls will be made.`);
    const classifier = await pipeline('zero-shot-image-classification', visionModelId, {
      cache_dir: join(root, 'node_modules', '.cache', 'tiny-outings-vision'),
      dtype: 'q4',
    });
    for (let index = 0; index < pending.length; index += 1) {
      const { entry, candidate, key } = pending[index];
      try {
        const image = await loadVisualImage(candidate);
        const labels = labelsForSerpApiImageAudit(entry.activity);
        const results = await classifier(image, labels, { hypothesis_template: 'This image shows {}.' });
        const assessment = assessSerpApiCandidate(entry.activity, policyCandidate(candidate), results);
        entry.assessments.set(key, assessment.outcome === 'retain' ? {
          visual_status: 'approved',
          visual_reason: assessment.reason,
          visual_confidence: retainedVisualConfidence(assessment),
          visual_assessment: assessment,
        } : {
          visual_status: 'rejected',
          visual_reason: assessment.reason,
          visual_confidence: Number(assessment.confidence) || null,
          visual_assessment: assessment,
        });
      } catch (error) {
        entry.assessments.set(key, {
          visual_status: 'rejected',
          visual_reason: `Visual assessment failed: ${error.message}`,
          visual_confidence: null,
        });
      }
      if ((index + 1) % 10 === 0 || index + 1 === pending.length) {
        console.log(`Cross-source visual assessments: ${index + 1}/${pending.length} complete.`);
      }
    }
  }
  return prepared.map(({ activity, assessments }) => ({ ...activity, automated_visual_assessments: assessments }));
}

function buildProposals(targets, model) {
  const proposals = [];
  const skipped = [];
  for (const activity of targets) {
    const recommendation = rankCrossSourceCandidates(activity, model, {
      requireVisualApproval: true,
      visualAssessments: activity.automated_visual_assessments,
    });
    const normalizedCandidates = crossSourceCandidateSet(activity);
    const hasSerpApiCandidates = Array.isArray(activity.serpapi_image_candidates) && activity.serpapi_image_candidates.length;
    const candidateSetSearchedAt = activity.codex_image_searched_at
      || (hasSerpApiCandidates ? activity.serpapi_image_candidates_fetched_at : activity.website_image_candidates_fetched_at)
      || activity.serpapi_image_candidates_fetched_at
      || null;
    if (!recommendation) {
      const reasonCode = normalizedCandidates.length ? 'no-eligible-candidate' : 'no-stored-candidates';
      skipped.push({ activity_id: activity.activity_id, activity_name: activity.activity_name, reason: reasonCode });
      proposals.push({
        activity_id: activity.activity_id,
        source_queue: activity.automated_source_queue,
        candidate_index: null,
        candidate: {},
        terminal_rejection: true,
        candidate_set_searched_at: candidateSetSearchedAt,
        confidence: 0.5,
        reason: reasonCode === 'no-eligible-candidate'
          ? 'The learned cross-source selector ran, but no candidate passed identity, logo, resolution and visual-quality checks; category artwork remains the fallback.'
          : 'The learned cross-source selector ran, but no stored image candidates were available; category artwork remains the fallback.',
        model_name: model.name,
        model_version: model.version,
        training_review_count: model.trainingReviewCount,
        model_metrics: model.metrics,
        feature_snapshot: { eligible_candidate_count: 0 },
      });
      continue;
    }
    proposals.push({
      activity_id: activity.activity_id,
      source_queue: activity.automated_source_queue,
      candidate_index: recommendation.candidateIndex,
      candidate: recommendation.candidate,
      candidate_set_searched_at: candidateSetSearchedAt,
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

async function applyPendingImages(maximumPasses = 3, modelVersion = '') {
  let applied = 0;
  let preserved = 0;
  let failed = 0;
  for (let pass = 1; pass <= maximumPasses; pass += 1) {
    if (pass > 1) {
      const reset = await callFunction('activity-image-auto-review', {
        action: 'reset_apply_failures',
        ...(modelVersion ? { model_version: modelVersion } : {}),
      });
      if (!reset.reset_count) break;
      console.log(`Retry pass ${pass}: reset ${reset.reset_count} failed applications.`);
    }
    let remaining = 1;
    let passProcessed = 0;
    while (remaining > 0) {
      const payload = await callFunction('activity-image-auto-review', {
        action: 'apply_pending',
        batch_size: 20,
        ...(modelVersion ? { model_version: modelVersion } : {}),
      }, 180000);
      const rows = payload.rows || [];
      if (!rows.length) break;
      passProcessed += rows.length;
      applied += rows.filter((row) => ['auto-applied', 'already-applied'].includes(row.status)).length;
      preserved += rows.filter((row) => ['preserved-existing-review', 'preserved-existing-model-selection', 'archived'].includes(row.status)).length;
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
  const targetLabel = scope === 'all_unreviewed'
    ? 'Never-reviewed published/draft'
    : scope === 'all_active' ? 'All active published/draft'
    : scope === 'failed_applications' ? 'Failed automatic image applications' : 'Active missing/unsuitable';
  const targetScopeLabel = [sourceName ? `source ${sourceName}` : '', missingOnly ? 'missing frontend images only' : ''].filter(Boolean).join('; ');
  console.log(`${targetLabel} targets${targetScopeLabel ? ` (${targetScopeLabel})` : ''}: ${targets.length}.`);
  const batchTargets = targets.slice(0, Number.isFinite(limit) ? limit : undefined);
  if (batchTargets.length < targets.length) {
    console.log(`This run is limited to the first ${batchTargets.length} targets; visual assessment and optional image search will not touch the remaining ${targets.length - batchTargets.length}.`);
  }
  const candidateResult = await fillMissingCandidateSets(batchTargets);
  const visuallyAssessedTargets = await addVisualAssessments(candidateResult.targets, model);
  const { proposals, skipped } = buildProposals(visuallyAssessedTargets, model);
  console.log(`Proposals ready: ${proposals.length}; skipped: ${skipped.length}.`);
  const stored = apply ? await storeProposals(proposals) : 0;
  const automaticApplication = apply && stored ? await applyPendingImages(3, model.version) : null;
  const activityById = new Map(batchTargets.map((activity) => [activity.activity_id, activity]));
  const report = {
    generated_at: new Date().toISOString(),
    applied: apply,
    scope,
    source_name: sourceName || null,
    missing_only: missingOnly,
    cross_source_selection: true,
    visual_assessment: {
      enabled: visualAssessmentEnabled,
      model: visionModelId,
      finalists_per_activity: visualFinalists,
    },
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
    processed_target_count: batchTargets.length,
    serpapi_search_count: candidateResult.searched,
    serpapi_failure_count: candidateResult.failed.length,
    proposal_count: proposals.length,
    stored_count: stored,
    automatic_application: automaticApplication,
    skipped_counts: Object.fromEntries([...new Set(skipped.map((row) => row.reason))].map((reason) => [reason, skipped.filter((row) => row.reason === reason).length])),
    selected_source_counts: proposals.reduce((counts, proposal) => {
      const source = proposal.terminal_rejection
        ? 'category_art_fallback'
        : proposal.candidate?.source_field || proposal.candidate?.candidate_source || 'unknown';
      counts[source] = (counts[source] || 0) + 1;
      return counts;
    }, {}),
    selections: proposals.map((proposal) => ({
      activity_id: proposal.activity_id,
      activity_name: activityById.get(proposal.activity_id)?.activity_name || null,
      source: proposal.terminal_rejection
        ? 'category_art_fallback'
        : proposal.candidate?.source_field || proposal.candidate?.candidate_source || 'unknown',
      image_url: proposal.terminal_rejection ? null : proposal.candidate?.image_url || null,
      confidence: proposal.confidence,
      reason: proposal.reason,
    })),
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
