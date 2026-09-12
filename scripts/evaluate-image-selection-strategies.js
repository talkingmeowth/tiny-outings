/* global process */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, RawImage } from '@huggingface/transformers';
import {
  crossSourceCandidateSet,
  crossSourceCandidateRanking,
  rankCrossSourceCandidates,
  taggedChoiceGroups,
  trainTaggedImageRanker,
} from './lib/tagged-image-ranker.js';
import { activityImageGroupKey } from '../src/activityDuplicates.js';
import {
  assessSerpApiCandidate,
  labelsForSerpApiImageAudit,
} from './lib/serpapi-image-confidence-policy.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const reportPath = join(root, 'data', 'image_selection_strategy_evaluation.generated.json');
const inputCachePath = join(root, 'data', 'image_selection_evaluation_input.cache.json');
const visualCachePath = join(root, 'data', 'image_selection_visual_assessment.cache.json');
const refreshData = process.argv.includes('--refresh-data');
const sampleIndex = process.argv.indexOf('--visual-sample');
const visualSampleSize = sampleIndex >= 0 ? Math.max(0, Number(process.argv[sampleIndex + 1]) || 0) : 50;
const finalistsIndex = process.argv.indexOf('--visual-finalists');
const visualFinalists = finalistsIndex >= 0 ? Math.min(8, Math.max(1, Number(process.argv[finalistsIndex + 1]) || 4)) : 4;
const skipVisual = process.argv.includes('--skip-visual') || visualSampleSize === 0;
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

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const envPath = process.env.TINY_OUTINGS_ENV_FILE ? resolve(process.env.TINY_OUTINGS_ENV_FILE) : join(root, '.env.local');
const localEnv = readDotEnv(envPath);
const supabaseUrl = process.env.VITE_SUPABASE_URL || localEnv.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || localEnv.VITE_SUPABASE_ANON_KEY;
const jobSecret = process.env.TINY_OUTINGS_IMAGE_JOB_SECRET || localEnv.TINY_OUTINGS_IMAGE_JOB_SECRET;

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function key(value) {
  return clean(value).replace(/^http:\/\//i, 'https://');
}

function categoryKey(value) {
  return clean(value) || 'Uncategorised';
}

function deterministicBucket(value) {
  let hash = 2166136261;
  for (const char of clean(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 5;
}

function deterministicOrder(value) {
  let hash = 2166136261;
  for (const char of clean(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function callFunction(body) {
  if (!supabaseUrl || !supabaseAnonKey || !jobSecret) throw new Error('Evaluation environment is incomplete.');
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/activity-image-auto-review`, {
        method: 'POST',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
          'x-tiny-outings-image-job-token': jobSecret,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;
      lastError = new Error(payload.error || `Training-data request returned ${response.status}.`);
      if (![429, 500, 502, 503, 504].includes(response.status)) throw lastError;
    } catch (error) {
      lastError = error;
      if (attempt === 4 || !['AbortError', 'TimeoutError', 'TypeError'].includes(error?.name)) throw error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500 * (2 ** (attempt - 1))));
  }
  throw lastError || new Error('Training-data request exhausted all retries.');
}

async function loadLegacyTrainingRows() {
  const rows = [];
  let offset = 0;
  do {
    const payload = await callFunction({ action: 'training_data', offset, page_size: 200 });
    rows.push(...(payload.rows || []));
    offset = payload.next_offset;
    console.log(`Ground truth loaded: ${rows.length}${offset == null ? '' : '+'}.`);
  } while (offset != null);
  return rows;
}

async function loadUnifiedGroundTruthRows() {
  const rows = [];
  let offset = 0;
  do {
    const payload = await callFunction({ action: 'ground_truth_data', offset, page_size: 500 });
    rows.push(...(payload.rows || []));
    offset = payload.next_offset;
  } while (offset != null);
  return rows;
}

async function loadActiveActivities() {
  const rows = [];
  let offset = 0;
  do {
    const payload = await callFunction({ action: 'targets', scope: 'all_active', offset, page_size: 500 });
    rows.push(...(payload.rows || []));
    offset = payload.next_offset;
    console.log(`Candidate-bearing activities loaded: ${rows.length}${offset == null ? '' : '+'}.`);
  } while (offset != null);
  return rows;
}

function unifiedTrainingRows(groundTruth, activities) {
  const activityById = new Map(activities.map((activity) => [String(activity.activity_id), activity]));
  const deduplicated = new Map();
  for (const row of groundTruth) {
    if (!row.is_photo) continue;
    const activity = activityById.get(String(row.activity_id));
    if (!activity) continue;
    const originalImageUrl = key(row.original_image_url || row.image_url);
    if (!originalImageUrl) continue;
    const evidenceKey = `${activity.activity_id}|${originalImageUrl}`;
    const current = deduplicated.get(evidenceKey);
    const evidenceAt = Date.parse(row.evidence_at || 0) || 0;
    if (current && current.evidenceAt >= evidenceAt) continue;
    deduplicated.set(evidenceKey, {
      evidenceAt,
      row: {
        ground_truth_id: row.ground_truth_id,
        manual_review_id: row.ground_truth_id,
        activity_id: row.activity_id,
        original_image_url: originalImageUrl,
        selected_image_url: key(row.image_url),
        source_page_url: row.source_page_url,
        candidate: row.metadata || {},
        evidence_type: row.evidence_type,
        evidence_at: row.evidence_at,
        activity,
      },
    });
  }
  return [...deduplicated.values()].map((entry) => entry.row);
}

function selectedKeys(group) {
  return (group.selectedIndices || [group.selectedIndex])
    .map((index) => key(group.candidates[index]?.image_url))
    .filter(Boolean);
}

function predictedKey(candidate) {
  return key(candidate?.image_url);
}

function isCorrectPrediction(entry, candidate) {
  return Boolean(candidate) && entry.selected.includes(predictedKey(candidate));
}

function bestGoogleCandidate(group) {
  return group.candidates.filter((candidate) => candidate.candidate_source === 'google_images')
    .sort((left, right) => (left.source_position ?? 999) - (right.source_position ?? 999))[0] || null;
}

function highestResolutionCandidate(group) {
  return [...group.candidates].sort((left, right) => (
    (Number(right.width) || 0) * (Number(right.height) || 0)
    - (Number(left.width) || 0) * (Number(left.height) || 0)
  ))[0] || null;
}

function metadataScore(row) {
  const features = row.features;
  return (4.5 * features.title_name_overlap)
    + (1.8 * features.title_location_overlap)
    + (0.9 * features.official_source)
    + (0.6 * features.log_pixels)
    + (0.4 * features.card_aspect)
    + (0.35 * features.inverse_position)
    + (0.25 * features.scene_terms)
    - (0.8 * features.social_source)
    - (0.25 * features.directory_source);
}

function summarizeStrategy(cases, selector) {
  let correct = 0;
  let decisions = 0;
  for (const entry of cases) {
    const candidate = selector(entry);
    if (!candidate) continue;
    decisions += 1;
    if (isCorrectPrediction(entry, candidate)) correct += 1;
  }
  return {
    evaluated: cases.length,
    decisions,
    coverage: Number((decisions / Math.max(1, cases.length)).toFixed(4)),
    exact_matches: correct,
    precision_when_selected: Number((correct / Math.max(1, decisions)).toFixed(4)),
    overall_accuracy: Number((correct / Math.max(1, cases.length)).toFixed(4)),
  };
}

function precisionCurve(cases, thresholds, valueForCase) {
  return thresholds.map((threshold) => {
    const selected = cases.filter((entry) => valueForCase(entry) >= threshold);
    const correct = selected.filter((entry) => isCorrectPrediction(entry, entry.ranking[0]?.candidate)).length;
    return {
      threshold,
      decisions: selected.length,
      coverage: Number((selected.length / Math.max(1, cases.length)).toFixed(4)),
      precision: Number((correct / Math.max(1, selected.length)).toFixed(4)),
    };
  });
}

function categoryPerformance(cases) {
  const categories = new Map();
  for (const entry of cases) {
    const category = categoryKey(entry.group.activity.category);
    const row = categories.get(category) || { evaluated: 0, correct: 0, top3: 0 };
    row.evaluated += 1;
    const position = entry.ranking.findIndex((candidate) => entry.selected.includes(predictedKey(candidate.candidate)));
    if (position === 0) row.correct += 1;
    if (position >= 0 && position < 3) row.top3 += 1;
    categories.set(category, row);
  }
  return Object.fromEntries([...categories.entries()].sort((left, right) => right[1].evaluated - left[1].evaluated)
    .map(([category, row]) => [category, {
      ...row,
      top_1_accuracy: Number((row.correct / row.evaluated).toFixed(4)),
      top_3_recall: Number((row.top3 / row.evaluated).toFixed(4)),
    }]));
}

function sourceDistribution(groups) {
  const counts = {};
  for (const group of groups) {
    for (const index of group.selectedIndices || [group.selectedIndex]) {
      const candidate = group.candidates[index];
      const source = candidate.source_field || candidate.candidate_source || 'unknown';
      counts[source] = (counts[source] || 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]));
}

function stratifiedSample(cases, maximum) {
  const buckets = new Map();
  for (const entry of cases) {
    const category = categoryKey(entry.group.activity.category);
    const rows = buckets.get(category) || [];
    rows.push(entry);
    buckets.set(category, rows);
  }
  for (const rows of buckets.values()) rows.sort((left, right) => deterministicOrder(left.group.reviewId) - deterministicOrder(right.group.reviewId));
  const orderedBuckets = [...buckets.entries()].sort((left, right) => right[1].length - left[1].length);
  const sample = [];
  let index = 0;
  while (sample.length < maximum && orderedBuckets.some(([, rows]) => index < rows.length)) {
    for (const [, rows] of orderedBuckets) {
      if (sample.length >= maximum) break;
      if (rows[index]) sample.push(rows[index]);
    }
    index += 1;
  }
  return sample;
}

async function loadVisualImage(candidate) {
  let lastError;
  for (const url of [...new Set([candidate.image_url, candidate.thumbnail_url].filter(Boolean))]) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().startsWith('image/')) {
        throw new Error(`download returned ${response.status}`);
      }
      const image = await RawImage.fromBlob(await response.blob());
      if (Math.min(Number(image.width) || 0, Number(image.height) || 0) < 300) throw new Error('image was below 300px');
      return image;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('image could not be loaded');
}

function policyCandidate(candidate, image) {
  return {
    original: candidate.image_url,
    thumbnail: candidate.thumbnail_url,
    link: candidate.source_page_url,
    source: candidate.source_domain,
    title: candidate.title,
    original_width: candidate.width || image.width,
    original_height: candidate.height || image.height,
  };
}

async function visualEvaluation(cases) {
  if (skipVisual) return null;
  const sample = stratifiedSample(cases, Math.min(visualSampleSize, cases.length));
  console.log(`Loading ${visionModelId} for a stratified ${sample.length}-listing visual evaluation.`);
  const classifier = await pipeline('zero-shot-image-classification', visionModelId, {
    cache_dir: join(root, 'node_modules', '.cache', 'tiny-outings-vision'),
    dtype: 'q4',
  });
  const visualCache = readJson(visualCachePath) || {};
  let visualCacheChanged = false;
  const rows = [];
  for (let caseIndex = 0; caseIndex < sample.length; caseIndex += 1) {
    const entry = sample[caseIndex];
    const learnedFinalists = entry.ranking.slice(0, visualFinalists);
    const googleFinalists = entry.group.candidates
      .filter((candidate) => candidate.candidate_source === 'google_images')
      .sort((left, right) => (left.source_position ?? 999) - (right.source_position ?? 999))
      .slice(0, visualFinalists);
    const finalistByUrl = new Map();
    for (const finalist of learnedFinalists) finalistByUrl.set(predictedKey(finalist.candidate), finalist);
    for (const candidate of googleFinalists) {
      const candidateUrl = predictedKey(candidate);
      if (!finalistByUrl.has(candidateUrl)) finalistByUrl.set(candidateUrl, {
        candidate,
        candidateIndex: candidate.candidate_set_index,
        score: null,
        features: null,
      });
    }
    const modelFinalistKeys = new Set(finalistByUrl.keys());
    const evaluationFinalistByUrl = new Map(finalistByUrl);
    for (const selectedIndex of entry.group.selectedIndices || [entry.group.selectedIndex]) {
      const candidate = entry.group.candidates[selectedIndex];
      const candidateUrl = predictedKey(candidate);
      if (!evaluationFinalistByUrl.has(candidateUrl)) evaluationFinalistByUrl.set(candidateUrl, {
        candidate,
        candidateIndex: candidate.candidate_set_index,
        score: null,
        features: null,
        evaluation_only: true,
      });
    }
    const finalists = [...evaluationFinalistByUrl.values()];
    const assessments = [];
    for (const finalist of finalists) {
      const cacheKey = `${entry.group.activity.activity_id}|${predictedKey(finalist.candidate)}`;
      if (visualCache[cacheKey]) {
        assessments.push({ finalist, assessment: visualCache[cacheKey] });
        continue;
      }
      try {
        const image = await loadVisualImage(finalist.candidate);
        const labels = labelsForSerpApiImageAudit(entry.group.activity);
        const results = await classifier(image, labels, { hypothesis_template: 'This image shows {}.' });
        const assessment = {
          ...assessSerpApiCandidate(entry.group.activity, policyCandidate(finalist.candidate, image), results),
          downloaded_width: image.width,
          downloaded_height: image.height,
        };
        assessments.push({ finalist, assessment });
        visualCache[cacheKey] = assessment;
        visualCacheChanged = true;
      } catch (error) {
        assessments.push({ finalist, assessment: { outcome: 'remove', reason: `Visual load failed: ${error.message}` } });
      }
    }
    const assessmentByUrl = new Map(assessments.map((row) => [predictedKey(row.finalist.candidate), row]));
    const visualAssessments = new Map(assessments
      .filter((row) => modelFinalistKeys.has(predictedKey(row.finalist.candidate)))
      .map((row) => [predictedKey(row.finalist.candidate), {
        visual_status: row.assessment.outcome === 'retain' ? 'approved' : 'rejected',
        visual_reason: row.assessment.reason,
        visual_confidence: Number(row.assessment.confidence) || null,
        visual_assessment: row.assessment,
      }]));
    const recommendation = rankCrossSourceCandidates(entry.group.activity, entry.model, {
      requireVisualApproval: true,
      visualAssessments,
      allowVisualFallback: true,
    });
    const learnedTop = entry.ranking[0]?.candidate || null;
    const learnedTopAssessment = assessmentByUrl.get(predictedKey(learnedTop));
    const learnedTopRecommendation = learnedTopAssessment?.assessment.outcome === 'retain'
      ? rankCrossSourceCandidates(entry.group.activity, entry.model, {
        requireVisualApproval: true,
        visualAssessments: new Map(entry.group.candidates.map((candidate) => {
          const candidateUrl = predictedKey(candidate);
          return [candidateUrl, candidateUrl === predictedKey(learnedTop)
            ? visualAssessments.get(candidateUrl)
            : { visual_status: 'rejected', visual_reason: 'Outside the metadata top choice.' }];
        })),
      })
      : null;
    const chosen = recommendation?.candidate || null;
    const retained = chosen ? assessmentByUrl.get(predictedKey(chosen)) : null;
    const firstGoogle = googleFinalists[0] || null;
    const firstGoogleAssessment = assessmentByUrl.get(predictedKey(firstGoogle));
    const firstGoogleRanking = entry.ranking.find((row) => predictedKey(row.candidate) === predictedKey(firstGoogle));
    const firstGoogleAfterVeto = firstGoogleAssessment?.assessment.outcome === 'retain' ? firstGoogle : null;
    const firstGoogleEvidence = firstGoogleAssessment?.assessment || null;
    const firstGoogleMinimumSide = firstGoogleEvidence
      ? Math.min(Number(firstGoogleEvidence.downloaded_width) || 0, Number(firstGoogleEvidence.downloaded_height) || 0)
      : 0;
    const firstGoogleVisualMargin = firstGoogleEvidence?.visual
      ? Number(firstGoogleEvidence.visual.accepted) - Number(firstGoogleEvidence.visual.rejected)
      : -1;
    const firstGoogleHighPrecision = firstGoogleAfterVeto
      && firstGoogleEvidence?.provenance?.exactTitle
      && (firstGoogleEvidence.provenance.official || Number(firstGoogleRanking?.features?.title_location_overlap) >= 0.35)
      && Number(firstGoogleEvidence.visual?.accepted) >= 0.6
      && firstGoogleVisualMargin >= 0.25
      && firstGoogleMinimumSide >= 500
      ? firstGoogle : null;
    const firstRetainedGoogleRow = googleFinalists.map((candidate) => assessmentByUrl.get(predictedKey(candidate)))
      .find((row) => row?.assessment.outcome === 'retain');
    const visuallyRankedGoogle = googleFinalists.map((candidate) => assessmentByUrl.get(predictedKey(candidate)))
      .filter((row) => row?.assessment.outcome === 'retain')
      .sort((left, right) => {
        const leftVisual = left.assessment.visual || {};
        const rightVisual = right.assessment.visual || {};
        const leftPixels = (Number(left.finalist.candidate.width) || 0) * (Number(left.finalist.candidate.height) || 0);
        const rightPixels = (Number(right.finalist.candidate.width) || 0) * (Number(right.finalist.candidate.height) || 0);
        const leftScore = (Number(leftVisual.preference_rank) || 0) * 100
          + (Number(left.assessment.confidence) || 0) * 10
          + Math.min(5, Math.log10(Math.max(1, leftPixels)))
          - (Number(left.finalist.candidate.source_position) || 0) * 0.15;
        const rightScore = (Number(rightVisual.preference_rank) || 0) * 100
          + (Number(right.assessment.confidence) || 0) * 10
          + Math.min(5, Math.log10(Math.max(1, rightPixels)))
          - (Number(right.finalist.candidate.source_position) || 0) * 0.15;
        return rightScore - leftScore;
      });
    const selectedAssessments = assessments.filter((row) => entry.selected.includes(predictedKey(row.finalist.candidate)));
    const groundTruthAvailable = selectedAssessments.some((row) => !/^Visual load failed:/i.test(row.assessment.reason || ''));
    rows.push({
      activity_id: entry.group.activity.activity_id,
      activity_name: entry.group.activity.activity_name,
      category: entry.group.activity.category,
      selected_image_urls: entry.selected,
      ground_truth_available: groundTruthAvailable,
      selected_in_shortlist: [...modelFinalistKeys].some((candidateUrl) => entry.selected.includes(candidateUrl)),
      human_choice_passed_gate: assessments.some((row) => entry.selected.includes(predictedKey(row.finalist.candidate)) && row.assessment.outcome === 'retain'),
      chosen_image_url: chosen?.image_url || null,
      chosen_source: chosen?.source_field || chosen?.candidate_source || null,
      model_confidence: recommendation?.confidence || null,
      source_conflict: recommendation?.featureSnapshot?.source_conflict || 0,
      exact_match: Boolean(chosen && entry.selected.includes(predictedKey(chosen))),
      abstained: !chosen,
      chosen_reason: recommendation?.reason || retained?.assessment.reason || null,
      selected_candidate_reason: assessments.find((row) => entry.selected.includes(predictedKey(row.finalist.candidate)))?.assessment.reason || null,
      strategy_choices: {
        learned_first_acceptable: chosen?.image_url || null,
        learned_top_1_after_visual_veto: learnedTopRecommendation?.candidate?.image_url || null,
        google_result_1: firstGoogle?.image_url || null,
        google_result_1_after_visual_identity_veto: firstGoogleAfterVeto?.image_url || null,
        google_result_1_high_precision_gate: firstGoogleHighPrecision?.image_url || null,
        first_acceptable_top_google: firstRetainedGoogleRow?.finalist.candidate.image_url || null,
        visually_best_top_google: visuallyRankedGoogle[0]?.finalist.candidate.image_url || null,
      },
      strategy_confidence: {
        learned_first_acceptable: recommendation?.confidence || null,
        learned_top_1_after_visual_veto: learnedTopRecommendation?.confidence || null,
      },
      first_google_evidence: firstGoogleEvidence ? {
        outcome: firstGoogleEvidence.outcome,
        reason: firstGoogleEvidence.reason,
        confidence: firstGoogleEvidence.confidence,
        provenance: firstGoogleEvidence.provenance,
        visual: firstGoogleEvidence.visual,
        downloaded_width: firstGoogleEvidence.downloaded_width,
        downloaded_height: firstGoogleEvidence.downloaded_height,
        title_name_overlap: firstGoogleRanking?.features?.title_name_overlap ?? null,
        title_location_overlap: firstGoogleRanking?.features?.title_location_overlap ?? null,
        official_source: firstGoogleRanking?.features?.official_source ?? null,
      } : null,
    });
    if ((caseIndex + 1) % 10 === 0 || caseIndex + 1 === sample.length) {
      console.log(`Visual ground-truth evaluation: ${caseIndex + 1}/${sample.length}.`);
      if (visualCacheChanged) writeFileSync(visualCachePath, `${JSON.stringify(visualCache)}\n`);
    }
  }
  const scorableRows = rows.filter((row) => row.ground_truth_available);
  function visualStrategy(field) {
    const decisions = scorableRows.filter((row) => clean(row.strategy_choices[field]));
    const exact = decisions.filter((row) => row.selected_image_urls.includes(key(row.strategy_choices[field])));
    return {
      decisions: decisions.length,
      abstentions: scorableRows.length - decisions.length,
      coverage: Number((decisions.length / Math.max(1, scorableRows.length)).toFixed(4)),
      exact_matches: exact.length,
      precision_when_selected: Number((exact.length / Math.max(1, decisions.length)).toFixed(4)),
      overall_accuracy: Number((exact.length / Math.max(1, scorableRows.length)).toFixed(4)),
    };
  }
  const strategies = {
    google_result_1: visualStrategy('google_result_1'),
    google_result_1_after_visual_identity_veto: visualStrategy('google_result_1_after_visual_identity_veto'),
    google_result_1_high_precision_gate: visualStrategy('google_result_1_high_precision_gate'),
    first_acceptable_top_google: visualStrategy('first_acceptable_top_google'),
    visually_best_top_google: visualStrategy('visually_best_top_google'),
    learned_first_acceptable: visualStrategy('learned_first_acceptable'),
    learned_top_1_after_visual_veto: visualStrategy('learned_top_1_after_visual_veto'),
  };
  const fallbackDecisions = scorableRows.filter((row) => !row.abstained);
  const fallbackExact = fallbackDecisions.filter((row) => row.exact_match);
  const recommendedDecisions = scorableRows.filter((row) => clean(row.strategy_choices.learned_top_1_after_visual_veto));
  const recommendedExact = recommendedDecisions.filter((row) => row.selected_image_urls
    .includes(key(row.strategy_choices.learned_top_1_after_visual_veto)));
  const confidenceThresholds = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];
  function visualConfidenceCurve(field) {
    return confidenceThresholds.map((threshold) => {
      const accepted = scorableRows.filter((row) => clean(row.strategy_choices[field])
        && Number(row.strategy_confidence[field]) >= threshold);
      const correct = accepted.filter((row) => row.selected_image_urls.includes(key(row.strategy_choices[field]))).length;
      return {
        threshold,
        decisions: accepted.length,
        coverage: Number((accepted.length / Math.max(1, scorableRows.length)).toFixed(4)),
        precision: Number((correct / Math.max(1, accepted.length)).toFixed(4)),
      };
    });
  }
  return {
    sample_size: rows.length,
    scorable_ground_truth_images: scorableRows.length,
    unavailable_ground_truth_images: rows.length - scorableRows.length,
    finalists_per_listing: visualFinalists,
    human_choice_in_shortlist: rows.filter((row) => row.selected_in_shortlist).length,
    human_choice_passed_visual_and_identity_gate: rows.filter((row) => row.human_choice_passed_gate).length,
    recommended_strategy: 'learned metadata top choice after source-conflict and visual-quality veto; no fall-through to a lower-ranked candidate',
    decisions: recommendedDecisions.length,
    abstentions: scorableRows.length - recommendedDecisions.length,
    coverage: Number((recommendedDecisions.length / Math.max(1, scorableRows.length)).toFixed(4)),
    exact_matches: recommendedExact.length,
    precision_when_selected: Number((recommendedExact.length / Math.max(1, recommendedDecisions.length)).toFixed(4)),
    overall_accuracy: Number((recommendedExact.length / Math.max(1, scorableRows.length)).toFixed(4)),
    strategies,
    confidence_precision_curve: visualConfidenceCurve('learned_top_1_after_visual_veto'),
    fallback_strategy: {
      decisions: fallbackDecisions.length,
      exact_matches: fallbackExact.length,
      coverage: Number((fallbackDecisions.length / Math.max(1, scorableRows.length)).toFixed(4)),
      precision_when_selected: Number((fallbackExact.length / Math.max(1, fallbackDecisions.length)).toFixed(4)),
    },
    fallback_confidence_precision_curve: confidenceThresholds.map((threshold) => {
      const accepted = fallbackDecisions.filter((row) => Number(row.model_confidence) >= threshold);
      const correct = accepted.filter((row) => row.exact_match).length;
      return {
        threshold,
        decisions: accepted.length,
        coverage: Number((accepted.length / Math.max(1, scorableRows.length)).toFixed(4)),
        precision: Number((correct / Math.max(1, accepted.length)).toFixed(4)),
      };
    }),
    false_positive_examples: recommendedDecisions.filter((row) => !row.selected_image_urls
      .includes(key(row.strategy_choices.learned_top_1_after_visual_veto))).slice(0, 20),
    rows,
  };
}

function matchedEvidenceCounts(rows) {
  const counts = {};
  for (const row of rows) {
    const selectedUrls = new Set([row.original_image_url, row.selected_image_url, row.image_url].map(key).filter(Boolean));
    const matched = crossSourceCandidateSet(row.activity).some((candidate) => selectedUrls.has(predictedKey(candidate)));
    if (!matched) continue;
    const evidenceType = row.evidence_type || 'unknown';
    counts[evidenceType] = (counts[evidenceType] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]));
}

async function main() {
  const previousReport = readJson(reportPath);
  const cachedInput = refreshData ? null : readJson(inputCachePath);
  const legacyRows = cachedInput?.legacyRows || await loadLegacyTrainingRows();
  const unifiedGroundTruth = cachedInput?.unifiedGroundTruth || await loadUnifiedGroundTruthRows();
  const activeActivities = cachedInput?.activeActivities || await loadActiveActivities();
  if (!cachedInput) writeFileSync(inputCachePath, `${JSON.stringify({ legacyRows, unifiedGroundTruth, activeActivities })}\n`);
  else console.log(`Using cached evaluation input from ${inputCachePath}.`);
  const rows = unifiedTrainingRows(unifiedGroundTruth, activeActivities);
  const allGroups = taggedChoiceGroups(rows);
  const cases = [];
  for (let fold = 0; fold < 5; fold += 1) {
    const trainingRows = rows.filter((row) => deterministicBucket(activityImageGroupKey(row.activity)) !== fold);
    const validationRows = rows.filter((row) => deterministicBucket(activityImageGroupKey(row.activity)) === fold);
    const model = trainTaggedImageRanker(trainingRows);
    const validationGroups = taggedChoiceGroups(validationRows);
    for (const group of validationGroups) {
      const ranking = crossSourceCandidateRanking(group.activity, model);
      if (!ranking.length) continue;
      const recommendation = rankCrossSourceCandidates(group.activity, model, { requireVisualApproval: false });
      cases.push({
        fold,
        model,
        group,
        ranking,
        selected: selectedKeys(group),
        score_gap: ranking.length > 1 ? ranking[0].score - ranking[1].score : 10,
        model_confidence: recommendation?.confidence || 0,
        source_conflict: recommendation?.featureSnapshot?.source_conflict || 0,
      });
    }
    console.log(`Cross-validation fold ${fold + 1}/5: ${validationGroups.length} ground-truth listings.`);
  }
  const strategies = {
    fixed_first_available: summarizeStrategy(cases, (entry) => entry.group.candidates[0] || null),
    first_google_result: summarizeStrategy(cases, (entry) => bestGoogleCandidate(entry.group)),
    highest_reported_resolution: summarizeStrategy(cases, (entry) => highestResolutionCandidate(entry.group)),
    deterministic_metadata_rules: summarizeStrategy(cases, (entry) => [...entry.ranking].sort((left, right) => metadataScore(right) - metadataScore(left))[0]?.candidate || null),
    learned_metadata_source_ranker: summarizeStrategy(cases, (entry) => entry.ranking[0]?.candidate || null),
    strict_metadata_abstention: summarizeStrategy(cases, (entry) => {
      const top = entry.ranking[0];
      if (!top || entry.score_gap < 0.75 || top.features.title_name_overlap < 0.65) return null;
      if (!top.features.official_source && top.features.title_location_overlap < 0.35) return null;
      if (top.features.source_conflict >= 0.6) return null;
      return top.candidate;
    }),
  };
  const visual = await visualEvaluation(cases);
  const report = {
    generated_at: new Date().toISOString(),
    methodology: 'Five-fold listing-identity cross-validation. Recurring sessions sharing a listing identity remain in one fold. Quick approvals, manual reviews, admin covers, admin URLs and uploads are positive ground truth; intentional category artwork is excluded from photo training. Exact match to any accepted image is counted as correct.',
    unified_ground_truth_rows: unifiedGroundTruth.length,
    unified_ground_truth_photo_rows: unifiedGroundTruth.filter((row) => row.is_photo).length,
    unified_ground_truth_evidence_counts: unifiedGroundTruth.reduce((counts, row) => ({
      ...counts,
      [row.evidence_type || 'unknown']: (counts[row.evidence_type || 'unknown'] || 0) + 1,
    }), {},),
    legacy_manual_review_rows: legacyRows.length,
    deduplicated_active_ground_truth_photo_rows: rows.length,
    matched_ground_truth_rows_by_evidence: matchedEvidenceCounts(rows),
    matched_ground_truth_listing_groups: allGroups.length,
    evaluated_cross_validation_groups: cases.length,
    ground_truth_category_counts: Object.fromEntries(Object.entries(categoryPerformance(cases)).map(([category, value]) => [category, value.evaluated])),
    ground_truth_selected_source_counts: sourceDistribution(allGroups),
    strategies,
    learned_ranker_by_category: categoryPerformance(cases),
    learned_score_gap_precision_curve: precisionCurve(cases, [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3], (entry) => entry.score_gap),
    model_confidence_precision_curve: precisionCurve(cases, [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9], (entry) => entry.model_confidence),
    source_conflict_summary: {
      clearly_conflicting_top_choices: cases.filter((entry) => entry.source_conflict >= 0.8).length,
      moderately_conflicting_top_choices: cases.filter((entry) => entry.source_conflict >= 0.6 && entry.source_conflict < 0.8).length,
      maximum_confidence_for_clear_conflict: 0.54,
      maximum_confidence_for_moderate_conflict: 0.66,
    },
    visual_hybrid: visual || previousReport?.visual_hybrid || null,
    visual_hybrid_generated_at: visual ? new Date().toISOString() : previousReport?.visual_hybrid_generated_at || previousReport?.generated_at || null,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Evaluation report written to ${reportPath}.`);
  console.log(JSON.stringify({ strategies, visual_hybrid: visual && {
    sample_size: visual.sample_size,
    coverage: visual.coverage,
    precision_when_selected: visual.precision_when_selected,
    overall_accuracy: visual.overall_accuracy,
  } }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
