/* global process */
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  candidateHost,
  chooseShortlist,
  imageCacheKey,
  scoreCandidateMetadata,
} from './lib/codex-image-shortlist-policy.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const queueOutputPath = join(root, 'data', 'codex_image_review_queue.generated.json');
const shortlistOutputPath = join(root, 'data', 'codex_image_shortlist.generated.json');
const applyOutputPath = join(root, 'data', 'codex_image_review_apply.generated.json');
const decisionsOutputPath = join(root, 'data', 'codex_image_review_decisions.generated.json');
const cacheRoot = join(root, 'data', 'codex-image-review-cache');
const sheetRoot = join(root, 'data', 'codex-image-review-sheets');
const model = 'gpt-5.6-sol';
const workflowVersion = 'codex-visual-v2';
const applyIndex = process.argv.indexOf('--apply');
const applyPath = applyIndex >= 0 ? process.argv[applyIndex + 1] : null;
const validateIndex = process.argv.indexOf('--validate-decisions');
const validatePath = validateIndex >= 0 ? process.argv[validateIndex + 1] : null;
const createDecisionsIndex = process.argv.indexOf('--create-decisions');
const createDecisionsValue = createDecisionsIndex >= 0 ? process.argv[createDecisionsIndex + 1] || null : null;
const offsetIndex = process.argv.indexOf('--offset');
const offset = offsetIndex >= 0 ? Math.max(0, Number(process.argv[offsetIndex + 1]) || 0) : 0;
const activityIdsFileIndex = process.argv.indexOf('--activity-ids-file');
const activityIdsFile = activityIdsFileIndex >= 0 ? process.argv[activityIdsFileIndex + 1] || null : null;
const limitIndex = process.argv.indexOf('--limit');
const limit = limitIndex >= 0
  ? Math.max(1, Number(process.argv[limitIndex + 1]) || 1)
  : activityIdsFile || applyPath || validatePath
    ? Number.POSITIVE_INFINITY
    : 10;
const finalistsIndex = process.argv.indexOf('--finalists');
const maximumFinalists = finalistsIndex >= 0 ? Math.min(5, Math.max(3, Number(process.argv[finalistsIndex + 1]) || 5)) : 5;
const sheetSizeIndex = process.argv.indexOf('--sheet-size');
const sheetSize = sheetSizeIndex >= 0 ? Math.min(12, Math.max(1, Number(process.argv[sheetSizeIndex + 1]) || 10)) : 10;
const dryRun = process.argv.includes('--dry-run');

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

const envPath = process.env.TINY_OUTINGS_ENV_FILE
  ? resolve(process.env.TINY_OUTINGS_ENV_FILE)
  : join(root, '.env.local');
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

async function callImageFunction(body, timeout = 150000) {
  assertConfiguration();
  const maximumAttempts = 4;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/cafe-image-importer`, {
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
      const retryable = [429, 500, 502, 503, 504].includes(response.status);
      if (!retryable || attempt === maximumAttempts) {
        throw new Error(payload.error || `Image enrichment function returned ${response.status}.`);
      }
      console.warn(`Image enrichment function returned ${response.status}; retrying (${attempt}/${maximumAttempts - 1}).`);
    } catch (error) {
      if (attempt === maximumAttempts || !['AbortError', 'TimeoutError', 'TypeError'].includes(error?.name)) throw error;
      console.warn(`Image enrichment request failed; retrying (${attempt}/${maximumAttempts - 1}).`);
    }
    await wait(500 * (2 ** (attempt - 1)));
  }
  throw new Error('Image enrichment request exhausted all retry attempts.');
}

async function fetchReviewQueue() {
  if (activityIdsFile) {
    const absolutePath = isAbsolute(activityIdsFile) ? activityIdsFile : resolve(root, activityIdsFile);
    const source = JSON.parse(readFileSync(absolutePath, 'utf8'));
    const ids = Array.isArray(source)
      ? source
      : Array.isArray(source.activity_ids)
        ? source.activity_ids
        : (source.results || []).filter((row) => row.status === 'candidates-stored').map((row) => row.activity_id);
    const requested = [...new Set(ids.filter((value) => typeof value === 'string' && value.trim()))];
    const rows = [];
    for (let start = 0; start < requested.length; start += 20) {
      const activityIds = requested.slice(start, start + 20);
      const payload = await callImageFunction({
        review_queue: true,
        batch_size: activityIds.length,
        activity_ids: activityIds,
      });
      rows.push(...(payload.rows || []));
      console.log(`Codex vision review queue: loaded ${rows.length}/${requested.length} new candidate sets.`);
    }
    return rows.slice(offset, Number.isFinite(limit) ? offset + limit : undefined);
  }
  const rows = [];
  let cursor = null;
  const target = Number.isFinite(limit) ? offset + limit : Number.POSITIVE_INFINITY;
  do {
    const remaining = Number.isFinite(target) ? target - rows.length : 20;
    if (remaining <= 0) break;
    const payload = await callImageFunction({
      review_queue: true,
      batch_size: Math.min(20, remaining),
      ...(cursor ? { cursor } : {}),
    });
    rows.push(...(payload.rows || []));
    cursor = payload.next_cursor || null;
    console.log(`Codex vision review queue: loaded ${rows.length}${cursor ? '+' : ''} pending candidate sets.`);
  } while (cursor && rows.length < target);
  return rows.slice(offset, Number.isFinite(limit) ? offset + limit : undefined);
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function decisionRows(path) {
  if (!path) throw new Error('--apply requires a JSON decision file.');
  const absolutePath = isAbsolute(path) ? path : resolve(root, path);
  const body = JSON.parse(readFileSync(absolutePath, 'utf8'));
  const rows = Array.isArray(body) ? body : body.decisions;
  if (!Array.isArray(rows) || !rows.length) throw new Error('The decision file must contain a non-empty decisions array.');
  const ids = new Set();
  return rows.slice(offset, Number.isFinite(limit) ? offset + limit : undefined).map((row, index) => {
    if (!row || typeof row !== 'object') throw new Error(`Decision ${index + 1} is not an object.`);
    if (!row.activity_id || ids.has(row.activity_id)) throw new Error(`Decision ${index + 1} has a missing or duplicate activity_id.`);
    ids.add(row.activity_id);
    if (!row.candidate_set_fetched_at || !Number.isFinite(Date.parse(row.candidate_set_fetched_at))) {
      throw new Error(`Decision ${index + 1} is missing a valid candidate_set_fetched_at.`);
    }
    if (row.candidate_index !== null && (!Number.isInteger(row.candidate_index) || row.candidate_index < 0)) {
      throw new Error(`Decision ${index + 1} has an invalid candidate_index.`);
    }
    if (row.candidate_index !== null && Array.isArray(row.finalist_candidate_indices)
      && !row.finalist_candidate_indices.includes(row.candidate_index)) {
      throw new Error(`Decision ${index + 1} selects a raw candidate that was not shown on its contact sheet.`);
    }
    if (!String(row.reason || '').trim()) throw new Error(`Decision ${index + 1} is missing a reason.`);
    return {
      activity_id: row.activity_id,
      candidate_index: row.candidate_index,
      selection_reason: `Codex 5.6 Sol vision review: ${String(row.reason).trim()}`,
      selection_confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : null,
      clear_selected_image: row.candidate_index === null,
      vision_review: {
        provider: 'codex',
        model,
        workflow_version: workflowVersion,
        candidate_set_fetched_at: row.candidate_set_fetched_at,
      },
    };
  });
}

async function applyDecisions(path) {
  const selections = decisionRows(path);
  const results = [];
  for (let offset = 0; offset < selections.length; offset += 20) {
    const payload = await callImageFunction({ selections: selections.slice(offset, offset + 20) });
    results.push(...(payload.results || []));
    const selected = results.filter((row) => row.status === 'selected').length;
    const rejected = results.filter((row) => row.status === 'no-high-confidence-candidate').length;
    const failed = results.length - selected - rejected;
    console.log(`Codex vision reviews applied: ${results.length}/${selections.length} (${selected} selected, ${rejected} rejected, ${failed} failed).`);
  }
  const audit = {
    generated_at: new Date().toISOString(),
    provider: 'codex',
    model,
    workflow_version: workflowVersion,
    reviewed: selections.length,
    selected: results.filter((row) => row.status === 'selected').length,
    rejected: results.filter((row) => row.status === 'no-high-confidence-candidate').length,
    failed: results.filter((row) => !['selected', 'no-high-confidence-candidate'].includes(row.status)).length,
    results,
  };
  writeJson(applyOutputPath, audit);
  if (audit.failed) process.exitCode = 1;
}

function validateDecisions(path) {
  const selections = decisionRows(path);
  const selected = selections.filter((row) => row.candidate_index !== null).length;
  console.log(`Validated ${selections.length} Codex vision decisions (${selected} selected, ${selections.length - selected} rejected) without database writes.`);
}

function createDecisions(choicesValue) {
  if (!choicesValue) throw new Error('--create-decisions requires comma-separated finalist numbers, using x for rejection.');
  const manifest = JSON.parse(readFileSync(shortlistOutputPath, 'utf8'));
  const activities = Array.isArray(manifest.activities) ? manifest.activities : [];
  const choices = choicesValue.split(',').map((value) => value.trim().toLowerCase());
  if (choices.length !== activities.length) {
    throw new Error(`Expected ${activities.length} choices for the current manifest but received ${choices.length}.`);
  }
  const decisions = activities.map((activity, index) => {
    const choice = choices[index];
    const finalistNumber = choice === 'x' ? null : Number(choice);
    if (finalistNumber !== null && (!Number.isInteger(finalistNumber) || finalistNumber < 1 || finalistNumber > activity.finalists.length)) {
      throw new Error(`Choice ${index + 1} for ${activity.activity_name} must be x or a finalist number from 1 to ${activity.finalists.length}.`);
    }
    const finalist = finalistNumber === null ? null : activity.finalists[finalistNumber - 1];
    const cafe = /cafe|coffee|bakery|food/i.test(`${activity.category || ''} ${activity.activity_name || ''}`);
    return {
      activity_id: activity.activity_id,
      activity_name: activity.activity_name,
      candidate_set_fetched_at: activity.candidate_set_fetched_at,
      finalist_candidate_indices: activity.finalists.map((entry) => entry.candidate_index),
      candidate_index: finalist?.candidate_index ?? null,
      reason: finalist
        ? cafe
          ? `Codex vision selected F${finalistNumber} as the clearest representative view of the cafe exterior, interior or seating.`
          : `Codex vision selected F${finalistNumber} as the clearest representative view of the listed activity or venue.`
        : 'Codex vision found no finalist that reliably and clearly represented the listed activity or venue.',
      confidence: finalist ? 0.9 : 0.95,
    };
  });
  writeJson(decisionsOutputPath, {
    generated_at: new Date().toISOString(),
    provider: 'codex',
    model,
    workflow_version: workflowVersion,
    decisions,
  });
  console.log(`Created ${decisions.length} Codex decisions (${decisions.filter((row) => row.candidate_index !== null).length} selected, ${decisions.filter((row) => row.candidate_index === null).length} rejected): ${decisionsOutputPath}`);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function xml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function short(value, maximum) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= maximum ? text : `${text.slice(0, maximum - 3)}...`;
}

function differenceHash(bytes) {
  let bits = '';
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      bits += bytes[row * 9 + column] > bytes[row * 9 + column + 1] ? '1' : '0';
    }
  }
  return bits.match(/.{4}/g).map((part) => Number.parseInt(part, 2).toString(16)).join('');
}

async function cachedImageAssessment(activity, candidate, metadataAssessment) {
  const relativePath = imageCacheKey(activity.activity_id, metadataAssessment.index, candidate.original);
  const cachePath = join(cacheRoot, relativePath);
  try {
    if (!existsSync(cachePath)) {
      let sourceBuffer = null;
      let failure = null;
      for (const url of [candidate.thumbnail, candidate.original].filter(Boolean)) {
        try {
          const response = await fetch(url, {
            redirect: 'follow',
            signal: AbortSignal.timeout(12000),
            headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', 'User-Agent': 'Mozilla/5.0 Tiny-Outings-Image-Review' },
          });
          const declared = Number(response.headers.get('content-length') || 0);
          if (!response.ok || declared > 6 * 1024 * 1024 || !(response.headers.get('content-type') || '').toLowerCase().startsWith('image/')) continue;
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length < 2048 || bytes.length > 6 * 1024 * 1024) continue;
          sourceBuffer = bytes;
          break;
        } catch (error) {
          failure = error;
        }
      }
      if (!sourceBuffer) throw failure || new Error('No downloadable thumbnail or original image.');
      mkdirSync(dirname(cachePath), { recursive: true });
      const normalised = await sharp(sourceBuffer, { failOn: 'warning' }).rotate()
        .resize({ width: 720, height: 540, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#f3f1eb' })
        .jpeg({ quality: 84, mozjpeg: true })
        .toBuffer();
      writeFileSync(cachePath, normalised);
    }
    const [imageMetadata, stats, hashBytes] = await Promise.all([
      sharp(cachePath).metadata(),
      sharp(cachePath).stats(),
      sharp(cachePath).resize(9, 8, { fit: 'fill' }).grayscale().raw().toBuffer(),
    ]);
    const entropy = stats.channels.reduce((sum, channel) => sum + Number(channel.entropy || 0), 0) / Math.max(1, stats.channels.length);
    const sharpness = Number(stats.sharpness || 0);
    const ratio = Number(imageMetadata.width || 1) / Number(imageMetadata.height || 1);
    let imageScore = 0;
    const imageReasons = [];
    if (entropy < 1.45) { imageScore -= 24; imageReasons.push('very low visual entropy'); }
    else if (entropy < 2.1) { imageScore -= 10; imageReasons.push('low visual entropy'); }
    else if (entropy >= 3.5 && entropy <= 7.8) { imageScore += 6; imageReasons.push('photographic detail'); }
    if (sharpness && sharpness < 0.8) { imageScore -= 12; imageReasons.push('soft image'); }
    else if (sharpness >= 2) { imageScore += 5; imageReasons.push('good sharpness'); }
    if (ratio >= 1.15 && ratio <= 2.1) imageScore += 7;
    else if (ratio < 0.5 || ratio > 2.8) imageScore -= 18;
    return {
      ...metadataAssessment,
      candidate,
      cache_path: cachePath,
      perceptual_hash: differenceHash(hashBytes),
      downloaded_width: imageMetadata.width,
      downloaded_height: imageMetadata.height,
      entropy: Number(entropy.toFixed(3)),
      sharpness: Number(sharpness.toFixed(3)),
      image_score: imageScore,
      image_reasons: imageReasons,
      total_score: metadataAssessment.score + imageScore,
      download_failed: false,
    };
  } catch (error) {
    return {
      ...metadataAssessment,
      candidate,
      total_score: metadataAssessment.score - 100,
      download_failed: true,
      download_error: error instanceof Error ? error.message : String(error),
      reject_reasons: [...metadataAssessment.reject_reasons, 'image_download_failed'],
    };
  }
}

async function buildActivitySheet(activity, finalists, ordinal) {
  const width = 1200;
  const height = 260;
  const tileWidth = 240;
  const imageHeight = 158;
  const composites = [];
  for (let index = 0; index < finalists.length; index += 1) {
    const finalist = finalists[index];
    const tile = await sharp(finalist.cache_path)
      .resize(tileWidth - 8, imageHeight - 8, { fit: 'cover', position: 'attention' })
      .jpeg({ quality: 82 })
      .toBuffer();
    composites.push({ input: tile, left: index * tileWidth + 4, top: 64 });
  }
  const labels = finalists.map((finalist, index) => {
    const domain = finalist.source_domain || candidateHost(finalist.candidate.link) || candidateHost(finalist.candidate.original) || 'unknown source';
    return `<rect x="${index * tileWidth + 8}" y="70" width="92" height="29" rx="5" fill="#111827" fill-opacity="0.92"/>
      <text x="${index * tileWidth + 16}" y="91" font-family="Arial" font-size="17" font-weight="700" fill="#ffffff">F${index + 1} / raw ${finalist.index}</text>
      <text x="${index * tileWidth + 8}" y="245" font-family="Arial" font-size="14" fill="#24383a">${xml(short(domain, 28))}</text>`;
  }).join('');
  const emptyState = finalists.length ? '' : `
    <rect x="8" y="76" width="1184" height="150" rx="8" fill="#e7e4dc"/>
    <text x="600" y="139" text-anchor="middle" font-family="Arial" font-size="25" font-weight="700" fill="#314c4f">NO RELIABLE FINALISTS</text>
    <text x="600" y="174" text-anchor="middle" font-family="Arial" font-size="17" fill="#526a6c">Codex decision should be null unless the manifest supplies contrary evidence.</text>`;
  const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="64" fill="#173f43"/>
    <text x="12" y="27" font-family="Arial" font-size="20" font-weight="700" fill="#ffffff">${xml(String(ordinal).padStart(4, '0'))}  ${xml(short(activity.activity_name, 92))}</text>
    <text x="12" y="51" font-family="Arial" font-size="14" fill="#d8eeee">${xml(short(`${activity.category || 'Uncategorised'} / ${activity.serpapi_image_search_ward || activity.borough || 'London'} / ${activity.address || ''}`, 145))}</text>
    ${labels}
    ${emptyState}
  </svg>`);
  composites.push({ input: overlay, left: 0, top: 0 });
  const activityDirectory = join(sheetRoot, 'activities');
  const activityPath = join(activityDirectory, `${activity.activity_id}.jpg`);
  mkdirSync(activityDirectory, { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: '#f3f1eb' } })
    .composite(composites)
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(activityPath);
  return activityPath;
}

async function buildBatchSheets(rows) {
  const outputs = [];
  const batchDirectory = join(sheetRoot, 'batches');
  mkdirSync(batchDirectory, { recursive: true });
  for (let start = 0; start < rows.length; start += sheetSize) {
    const batch = rows.slice(start, start + sheetSize).filter((row) => row.activity_sheet_path);
    if (!batch.length) continue;
    const composites = batch.map((row, index) => ({ input: row.activity_sheet_path, left: 0, top: index * 260 }));
    const first = batch[0].ordinal;
    const last = batch.at(-1).ordinal;
    const outputPath = join(batchDirectory, `review-${String(first).padStart(4, '0')}-${String(last).padStart(4, '0')}.jpg`);
    await sharp({ create: { width: 1200, height: batch.length * 260, channels: 3, background: '#f3f1eb' } })
      .composite(composites)
      .jpeg({ quality: 86, mozjpeg: true })
      .toFile(outputPath);
    outputs.push({ first, last, activity_ids: batch.map((row) => row.activity_id), path: outputPath });
    for (const row of batch) row.batch_sheet_path = outputPath;
  }
  return outputs;
}

async function shortlistActivity(activity, ordinal) {
  const candidates = Array.isArray(activity.serpapi_image_candidates) ? activity.serpapi_image_candidates : [];
  const metadata = candidates.map((candidate, index) => ({
    ...scoreCandidateMetadata(activity, candidate, index),
    candidate,
  }));
  const eligible = metadata.filter((entry) => !entry.rejected)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const downloadPool = eligible.slice(0, 10);
  const assessed = await mapWithConcurrency(downloadPool, 6, (entry) => cachedImageAssessment(activity, entry.candidate, entry));
  const finalists = chooseShortlist(assessed, maximumFinalists, 3);
  const activitySheetPath = await buildActivitySheet(activity, finalists, ordinal);
  const duplicateCount = assessed.filter((entry) => entry.reject_reasons?.includes('near_duplicate')).length;
  const downloadFailures = assessed.filter((entry) => entry.download_failed).length;
  return {
    ordinal,
    activity_id: activity.activity_id,
    activity_name: activity.activity_name,
    category: activity.category,
    address: activity.address,
    candidate_set_fetched_at: activity.serpapi_image_candidates_fetched_at,
    raw_candidate_count: candidates.length,
    metadata_rejected: metadata.filter((entry) => entry.rejected).length,
    removed_before_download: Math.max(0, eligible.length - downloadPool.length),
    thumbnails_downloaded: assessed.length - downloadFailures,
    download_failures: downloadFailures,
    near_duplicates_removed: duplicateCount,
    finalists_count: finalists.length,
    status: finalists.length
      ? 'ready_for_codex_vision'
      : downloadPool.length > 0 && downloadFailures === downloadPool.length
        ? 'image_download_failed'
        : 'no_candidates_after_filtering',
    activity_sheet_path: activitySheetPath,
    finalists: finalists.map((entry, index) => ({
      finalist_number: index + 1,
      candidate_index: entry.index,
      score: entry.total_score,
      original_url: entry.candidate.original,
      thumbnail_url: entry.candidate.thumbnail || null,
      source_page: entry.candidate.link || null,
      source_domain: entry.source_domain,
      title: entry.candidate.title || null,
      original_width: entry.candidate.original_width || null,
      original_height: entry.candidate.original_height || null,
      google_images_position: entry.candidate.position || entry.index + 1,
      deterministic_reasons: [...entry.reasons, ...(entry.image_reasons || [])],
    })),
    removed_examples: metadata.filter((entry) => entry.rejected).slice(0, 5).map((entry) => ({
      candidate_index: entry.index,
      title: entry.candidate.title || null,
      reasons: entry.reject_reasons,
    })),
  };
}

async function prepareReviewSheets() {
  const rows = await fetchReviewQueue();
  writeJson(queueOutputPath, {
    generated_at: new Date().toISOString(),
    provider: 'codex',
    model,
    workflow_version: workflowVersion,
    pending: rows.length,
    rows,
  });
  const prepared = [];
  for (let index = 0; index < rows.length; index += 1) {
    const result = await shortlistActivity(rows[index], offset + index + 1);
    prepared.push(result);
    console.log(`Shortlisted ${index + 1}/${rows.length}: ${result.activity_name} -- ${result.raw_candidate_count} raw, ${result.finalists_count} finalists, ${result.metadata_rejected + result.removed_before_download + result.download_failures + result.near_duplicates_removed} removed.`);
  }
  const batchSheets = await buildBatchSheets(prepared);
  const summary = prepared.reduce((counts, row) => {
    counts.raw_candidates += row.raw_candidate_count;
    counts.metadata_rejected += row.metadata_rejected;
    counts.removed_before_download += row.removed_before_download;
    counts.thumbnails_downloaded += row.thumbnails_downloaded;
    counts.download_failures += row.download_failures;
    counts.near_duplicates_removed += row.near_duplicates_removed;
    counts.finalists += row.finalists_count;
    counts[row.status] = (counts[row.status] || 0) + 1;
    return counts;
  }, {
    activities: prepared.length,
    raw_candidates: 0,
    metadata_rejected: 0,
    removed_before_download: 0,
    thumbnails_downloaded: 0,
    download_failures: 0,
    near_duplicates_removed: 0,
    finalists: 0,
    ready_for_codex_vision: 0,
    image_download_failed: 0,
    no_candidates_after_filtering: 0,
  });
  const output = {
    generated_at: new Date().toISOString(),
    provider: 'codex',
    model,
    workflow_version: workflowVersion,
    dry_run: dryRun,
    activity_ids_file: activityIdsFile,
    instructions: 'Review each labelled finalist strip with Codex multimodal vision. For cafes prefer a clear exterior/storefront, then an identifiable interior or seating overview. For every category prefer a genuine wide view that best explains the activity. Return null when no finalist is reliable. Raw candidate indices are zero-based and must be copied exactly from the labels.',
    summary,
    batch_sheets: batchSheets,
    activities: prepared,
    decisions_template: prepared.map((row) => ({
      activity_id: row.activity_id,
      activity_name: row.activity_name,
      candidate_set_fetched_at: row.candidate_set_fetched_at,
      finalist_candidate_indices: row.finalists.map((finalist) => finalist.candidate_index),
      candidate_index: null,
      reason: '',
      confidence: null,
    })),
  };
  writeJson(shortlistOutputPath, output);
  console.log(rows.length
    ? `Prepared ${prepared.length} activities and ${summary.finalists} finalists on ${batchSheets.length} compact Codex review sheets. Manifest: ${shortlistOutputPath}`
    : `No candidate sets are awaiting Codex vision review. Manifest: ${shortlistOutputPath}`);
}

const operation = applyPath
  ? applyDecisions(applyPath)
  : validatePath
    ? Promise.resolve(validateDecisions(validatePath))
    : createDecisionsValue
      ? Promise.resolve(createDecisions(createDecisionsValue))
    : prepareReviewSheets();

operation.catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
