/* global process */
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { activityImageGroupKey } from '../src/activityDuplicates.js';
import { candidateHost, chooseShortlist, scoreCandidateMetadata } from './lib/codex-image-shortlist-policy.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(root, 'data', 'codex_card_image_replacement_manifest.generated.json');
const decisionsPath = join(root, 'data', 'codex_card_image_replacement_decisions.generated.json');
const applyPath = join(root, 'data', 'codex_card_image_replacement_apply.generated.json');
const missingPath = join(root, 'data', 'codex_card_image_replacement_missing_candidates.generated.json');
const rejectedPath = join(root, 'data', 'codex_card_image_replacement_rejected.generated.json');
const freshReviewedPath = join(root, 'data', 'codex_card_image_fresh_reviewed.generated.json');
const freshSearchPath = join(root, 'data', 'codex_card_image_fresh_search_ids.generated.json');
const cacheRoot = join(root, 'data', 'codex-card-image-replacement-cache');
const sheetRoot = join(root, 'data', 'codex-card-image-replacement-sheets');
const model = 'gpt-5.6-sol';
const workflowVersion = 'codex-card-image-replacement-v1';
const limitIndex = process.argv.indexOf('--limit');
const limit = limitIndex >= 0 ? Math.max(1, Number(process.argv[limitIndex + 1]) || 1) : 80;
const sheetSizeIndex = process.argv.indexOf('--sheet-size');
const sheetSize = sheetSizeIndex >= 0 ? Math.min(10, Math.max(2, Number(process.argv[sheetSizeIndex + 1]) || 8)) : 8;
const finalistsIndex = process.argv.indexOf('--finalists');
const maximumFinalists = finalistsIndex >= 0 ? Math.min(4, Math.max(2, Number(process.argv[finalistsIndex + 1]) || 4)) : 4;
const createIndex = process.argv.indexOf('--create-decisions');
const createValue = createIndex >= 0 ? process.argv[createIndex + 1] || null : null;
const applyIndex = process.argv.indexOf('--apply');
const applyDecisionPath = applyIndex >= 0 ? process.argv[applyIndex + 1] || null : null;
const includeRejected = process.argv.includes('--include-rejected');
const freshPass = process.argv.includes('--fresh-pass');
const writeSearchQueue = process.argv.includes('--write-search-queue');

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

function assertConfig(forWrite = false) {
  if (!supabaseUrl || !supabaseAnonKey || (forWrite && !jobSecret)) throw new Error('Missing Supabase image audit configuration.');
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function secureUrl(value) {
  return String(value || '').trim().replace(/^http:\/\//i, 'https://');
}

function xml(value) {
  return String(value || '').replace(/[<>&'"]/g, (character) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  })[character]);
}

function short(value, maximum) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= maximum ? text : `${text.slice(0, maximum - 3)}...`;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function fetchActivities() {
  assertConfig();
  const fields = [
    'activity_id', 'activity_name', 'address', 'postcode', 'borough', 'category', 'description',
    'website', 'organiser_website', 'source_url', 'updated_at', 'created_at', 'admin_cover_image_url',
    'audit_image_url', 'audit_image_source_url', 'audit_image_status', 'audit_image_original_url',
    'audit_image_original_source_field', 'serpapi_image_candidates', 'serpapi_image_candidates_fetched_at',
    'serpapi_image_search_query', 'serpapi_image_search_ward',
  ].join(',');
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const url = new URL(`${supabaseUrl}/rest/v1/activities`);
    url.searchParams.set('select', fields);
    url.searchParams.set('archive', 'eq.false');
    url.searchParams.set('public_listing_status', 'in.(draft,published)');
    url.searchParams.set('audit_image_status', 'eq.needs_replacement');
    url.searchParams.set('order', 'activity_id.asc');
    url.searchParams.set('limit', '1000');
    url.searchParams.set('offset', String(offset));
    const response = await fetch(url, { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } });
    if (!response.ok) throw new Error(`Could not load replacement queue: ${response.status} ${await response.text()}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function rejectedKeys() {
  try {
    const body = JSON.parse(readFileSync(rejectedPath, 'utf8'));
    return new Set((body.rows || []).map((row) => `${row.activity_id}|${secureUrl(row.original_image_url)}`));
  } catch {
    return new Set();
  }
}

function freshReviewedKeys() {
  try {
    const body = JSON.parse(readFileSync(freshReviewedPath, 'utf8'));
    return new Set((body.rows || []).map((row) => `${row.activity_id}|${secureUrl(row.original_image_url)}`));
  } catch {
    return new Set();
  }
}

function replacementQueue(activities) {
  const groups = new Map();
  for (const activity of activities) {
    if (secureUrl(activity.admin_cover_image_url) || secureUrl(activity.audit_image_url)) continue;
    const key = activityImageGroupKey(activity);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(activity);
  }
  const rejected = rejectedKeys();
  const freshReviewed = freshReviewedKeys();
  const queue = [];
  for (const members of groups.values()) {
    const representative = [...members].sort((left, right) => {
      const difference = (right.serpapi_image_candidates?.length || 0) - (left.serpapi_image_candidates?.length || 0);
      return difference || String(left.activity_id).localeCompare(String(right.activity_id));
    })[0];
    const originalUrl = secureUrl(representative.audit_image_original_url);
    const seen = new Set();
    const candidates = members.flatMap((member) => Array.isArray(member.serpapi_image_candidates) ? member.serpapi_image_candidates : [])
      .filter((candidate) => {
        const url = secureUrl(candidate?.original);
        if (!url || url === originalUrl || seen.has(url)) return false;
        seen.add(url);
        return true;
      });
    const row = {
      ...representative,
      activity_ids: members.map((member) => member.activity_id),
      original_image_url: originalUrl,
      original_source_field: representative.audit_image_original_source_field,
      serpapi_image_candidates: candidates,
    };
    const key = `${row.activity_id}|${originalUrl}`;
    if (freshPass ? freshReviewed.has(key) : !includeRejected && rejected.has(key)) continue;
    queue.push(row);
  }
  return queue.sort((left, right) => String(left.activity_id).localeCompare(String(right.activity_id)));
}

function differenceHash(bytes) {
  let bits = '';
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) bits += bytes[row * 9 + column] > bytes[row * 9 + column + 1] ? '1' : '0';
  }
  return bits.match(/.{4}/g).map((part) => Number.parseInt(part, 2).toString(16)).join('');
}

async function downloadAssessment(activity, candidate, metadata) {
  const hash = createHash('sha1').update(secureUrl(candidate.original)).digest('hex');
  const cachePath = join(cacheRoot, activity.activity_id, `${metadata.index}-${hash.slice(0, 14)}.jpg`);
  try {
    let sourceWidth = Number(candidate.original_width || 0);
    let sourceHeight = Number(candidate.original_height || 0);
    if (!existsSync(cachePath)) {
      let bytes = null;
      for (const url of [candidate.original, candidate.thumbnail].filter(Boolean)) {
        try {
          const response = await fetch(secureUrl(url), {
            redirect: 'follow',
            signal: AbortSignal.timeout(12000),
            headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', 'User-Agent': 'Mozilla/5.0 Tiny-Outings-Audit' },
          });
          const type = (response.headers.get('content-type') || '').toLowerCase();
          if (!response.ok || !type.startsWith('image/')) continue;
          const candidateBytes = Buffer.from(await response.arrayBuffer());
          if (candidateBytes.length < 2048 || candidateBytes.length > 8 * 1024 * 1024) continue;
          bytes = candidateBytes;
          break;
        } catch {
          // Try the other stored URL.
        }
      }
      if (!bytes) throw new Error('candidate download failed');
      const source = sharp(bytes, { failOn: 'none' }).rotate();
      const sourceMetadata = await source.metadata();
      sourceWidth ||= Number(sourceMetadata.width || 0);
      sourceHeight ||= Number(sourceMetadata.height || 0);
      mkdirSync(dirname(cachePath), { recursive: true });
      await source.resize({ width: 760, height: 540, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#e5e2da' }).jpeg({ quality: 86, mozjpeg: true }).toFile(cachePath);
    }
    const [imageMetadata, stats, hashBytes] = await Promise.all([
      sharp(cachePath).metadata(),
      sharp(cachePath).stats(),
      sharp(cachePath).resize(9, 8, { fit: 'fill' }).grayscale().raw().toBuffer(),
    ]);
    sourceWidth ||= Number(imageMetadata.width || 0);
    sourceHeight ||= Number(imageMetadata.height || 0);
    const shortest = Math.min(sourceWidth, sourceHeight);
    const area = sourceWidth * sourceHeight;
    const ratio = sourceWidth / Math.max(1, sourceHeight);
    const entropy = stats.channels.reduce((sum, channel) => sum + Number(channel.entropy || 0), 0) / Math.max(1, stats.channels.length);
    const sharpness = Number(stats.sharpness || 0);
    const rejectReasons = [...metadata.reject_reasons];
    if (shortest < 300 || area < 180000) rejectReasons.push('low_resolution');
    if (ratio < 0.35 || ratio > 3.2) rejectReasons.push('extreme_aspect_ratio');
    let imageScore = 0;
    if (entropy < 1.45) imageScore -= 25;
    else if (entropy >= 3.4) imageScore += 6;
    if (sharpness && sharpness < 0.7) imageScore -= 14;
    else if (sharpness >= 2) imageScore += 5;
    return {
      ...metadata,
      candidate,
      cache_path: cachePath,
      source_width: sourceWidth,
      source_height: sourceHeight,
      perceptual_hash: differenceHash(hashBytes),
      image_score: imageScore,
      total_score: metadata.score + imageScore,
      rejected: rejectReasons.length > 0,
      reject_reasons: rejectReasons,
      download_failed: false,
    };
  } catch (error) {
    return { ...metadata, candidate, total_score: metadata.score - 100, rejected: true, reject_reasons: [...metadata.reject_reasons, 'image_download_failed'], download_failed: true, download_error: error.message };
  }
}

async function downloadOriginal(activity) {
  const url = activity.original_image_url;
  if (!url) return null;
  const path = join(cacheRoot, 'originals', `${createHash('sha1').update(url).digest('hex')}.jpg`);
  if (existsSync(path)) return path;
  try {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(12000) });
    if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().startsWith('image/')) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    mkdirSync(dirname(path), { recursive: true });
    await sharp(bytes, { failOn: 'none' }).rotate().resize(280, 184, { fit: 'cover', position: 'attention' })
      .flatten({ background: '#ddd8ce' }).jpeg({ quality: 84 }).toFile(path);
    return path;
  } catch {
    return null;
  }
}

async function makeRow(activity, finalists, ordinal) {
  const width = 1500;
  const height = 300;
  const imageTop = 68;
  const imageHeight = 184;
  const tileWidth = 300;
  const composites = [];
  const original = await downloadOriginal(activity);
  if (original) composites.push({ input: original, left: 10, top: imageTop });
  for (let index = 0; index < finalists.length; index += 1) {
    const tile = await sharp(finalists[index].cache_path).resize(tileWidth - 12, imageHeight, { fit: 'cover', position: 'attention' }).jpeg({ quality: 84 }).toBuffer();
    composites.push({ input: tile, left: (index + 1) * tileWidth + 6, top: imageTop });
  }
  const candidateLabels = finalists.map((finalist, index) => {
    const x = (index + 1) * tileWidth + 12;
    const domain = finalist.source_domain || candidateHost(finalist.candidate.link) || candidateHost(finalist.candidate.original) || 'unknown source';
    return `<rect x="${x}" y="74" width="62" height="28" rx="5" fill="#102f33"/><text x="${x + 10}" y="95" font-family="Arial" font-size="18" font-weight="700" fill="#fff">F${index + 1}</text><text x="${x}" y="277" font-family="Arial" font-size="14" fill="#d8eeee">${xml(short(`${finalist.source_width}x${finalist.source_height} / ${domain}`, 34))}</text>`;
  }).join('');
  const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <text x="12" y="28" font-family="Arial" font-size="20" font-weight="700" fill="#fff">${String(ordinal).padStart(4, '0')}  ${xml(short(activity.activity_name, 92))}</text>
    <text x="12" y="53" font-family="Arial" font-size="15" fill="#d8eeee">${xml(short(`${activity.category || 'Uncategorised'} / ${activity.serpapi_image_search_ward || activity.borough || 'London'} / ${activity.address || ''}`, 145))}</text>
    <rect x="10" y="74" width="115" height="28" rx="5" fill="#7f1d1d"/><text x="20" y="95" font-family="Arial" font-size="17" font-weight="700" fill="#fff">OLD / FAILED</text>
    ${original ? '' : '<rect x="10" y="68" width="280" height="184" fill="#d8d3c8"/><text x="150" y="165" text-anchor="middle" font-family="Arial" font-size="18" fill="#596264">unavailable</text>'}
    ${candidateLabels}
  </svg>`);
  composites.push({ input: overlay, left: 0, top: 0 });
  return sharp({ create: { width, height, channels: 3, background: '#173f43' } }).composite(composites).jpeg({ quality: 86 }).toBuffer();
}

async function buildSheets(rows) {
  mkdirSync(sheetRoot, { recursive: true });
  const outputs = [];
  for (let start = 0; start < rows.length; start += sheetSize) {
    const batch = rows.slice(start, start + sheetSize);
    const tiles = await Promise.all(batch.map((row) => makeRow(row, row._finalists, row.ordinal)));
    const path = join(sheetRoot, `review-${String(batch[0].ordinal).padStart(4, '0')}-${String(batch.at(-1).ordinal).padStart(4, '0')}.jpg`);
    await sharp({ create: { width: 1500, height: batch.length * 300, channels: 3, background: '#173f43' } })
      .composite(tiles.map((input, index) => ({ input, left: 0, top: index * 300 }))).jpeg({ quality: 86 }).toFile(path);
    outputs.push({ first: batch[0].ordinal, last: batch.at(-1).ordinal, path });
  }
  return outputs;
}

async function prepare() {
  const activities = await fetchActivities();
  const allGroups = replacementQueue(activities);
  const missing = allGroups.filter((activity) => !activity.serpapi_image_candidates.length);
  writeJson(missingPath, {
    generated_at: new Date().toISOString(),
    activity_ids: [...new Set(missing.flatMap((activity) => activity.activity_ids))],
    groups: missing.map((activity) => ({ activity_id: activity.activity_id, activity_name: activity.activity_name, activity_ids: activity.activity_ids })),
  });
  const pending = allGroups.filter((activity) => activity.serpapi_image_candidates.length).slice(0, limit);
  const prepared = [];
  for (let index = 0; index < pending.length; index += 1) {
    const activity = pending[index];
    const metadata = activity.serpapi_image_candidates.map((candidate, candidateIndex) => scoreCandidateMetadata(activity, candidate, candidateIndex));
    const pool = metadata.filter((entry) => !entry.rejected).sort((left, right) => right.score - left.score).slice(0, 10);
    const assessed = await mapWithConcurrency(pool, 6, (entry) => downloadAssessment(activity, activity.serpapi_image_candidates[entry.index], entry));
    const finalists = chooseShortlist(assessed, maximumFinalists, Math.min(2, maximumFinalists));
    prepared.push({ ...activity, ordinal: index + 1, _finalists: finalists });
    if ((index + 1) % 10 === 0 || index + 1 === pending.length) console.log(`Prepared replacement candidates ${index + 1}/${pending.length}.`);
  }
  const sheets = prepared.length ? await buildSheets(prepared) : [];
  writeJson(manifestPath, {
    generated_at: new Date().toISOString(), provider: 'codex', model, workflow_version: workflowVersion,
    audited_records_needing_replacement: activities.length,
    pending_groups_with_candidates: allGroups.filter((activity) => activity.serpapi_image_candidates.length).length,
    groups_missing_candidates: missing.length,
    prepared: prepared.length,
    sheets,
    activities: prepared.map((activity) => ({
      ordinal: activity.ordinal,
      activity_id: activity.activity_id,
      activity_ids: activity.activity_ids,
      activity_name: activity.activity_name,
      category: activity.category,
      address: activity.address,
      original_image_url: activity.original_image_url,
      original_source_field: activity.original_source_field,
      finalists: activity._finalists.map((entry, finalistIndex) => ({
        finalist_number: finalistIndex + 1,
        candidate_index: entry.index,
        original_url: secureUrl(entry.candidate.original),
        thumbnail_url: secureUrl(entry.candidate.thumbnail) || null,
        source_url: secureUrl(entry.candidate.link) || secureUrl(entry.candidate.original),
        source_domain: entry.source_domain,
        title: entry.candidate.title || null,
        width: entry.source_width,
        height: entry.source_height,
      })),
    })),
  });
  console.log(`Prepared ${prepared.length} replacement groups on ${sheets.length} sheets; ${allGroups.length} unresolved groups (${missing.length} need online search).`);
}

function createDecisions(value) {
  if (!value) throw new Error('--create-decisions requires comma-separated finalist numbers or x.');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const choices = value.split(',').map((choice) => choice.trim().toLowerCase());
  if (choices.length !== manifest.activities.length) throw new Error(`Expected ${manifest.activities.length} choices but received ${choices.length}.`);
  const decisions = manifest.activities.map((activity, index) => {
    const choice = choices[index];
    const number = choice === 'x' ? null : Number(choice);
    if (number !== null && (!Number.isInteger(number) || number < 1 || number > activity.finalists.length)) throw new Error(`Invalid replacement choice ${index + 1}: ${choice}`);
    const finalist = number === null ? null : activity.finalists[number - 1];
    return {
      ...activity,
      finalist_number: number,
      replacement: finalist,
      reason: finalist
        ? /cafe|coffee|bakery|restaurant|food/i.test(`${activity.category} ${activity.activity_name}`)
          ? `Codex 5.6 Sol selected F${number}: a clear, high-quality view of the cafe venue, interior, seating or exterior.`
          : `Codex 5.6 Sol selected F${number}: an accurate, representative, high-quality view of the activity or venue.`
        : 'No stored search candidate was accurate, representative and high-quality enough; a fresh online search is required.',
    };
  });
  writeJson(decisionsPath, { generated_at: new Date().toISOString(), provider: 'codex', model, workflow_version: workflowVersion, decisions });
  let rejected = [];
  try { rejected = JSON.parse(readFileSync(rejectedPath, 'utf8')).rows || []; } catch { /* no checkpoint yet */ }
  const byKey = new Map(rejected.map((row) => [`${row.activity_id}|${secureUrl(row.original_image_url)}`, row]));
  for (const row of decisions.filter((entry) => !entry.replacement)) byKey.set(`${row.activity_id}|${secureUrl(row.original_image_url)}`, { activity_id: row.activity_id, activity_name: row.activity_name, original_image_url: row.original_image_url, reason: row.reason });
  writeJson(rejectedPath, { generated_at: new Date().toISOString(), rows: [...byKey.values()] });
  if (freshPass) {
    let reviewed = [];
    try { reviewed = JSON.parse(readFileSync(freshReviewedPath, 'utf8')).rows || []; } catch { /* no fresh-pass checkpoint yet */ }
    const reviewedByKey = new Map(reviewed.map((row) => [`${row.activity_id}|${secureUrl(row.original_image_url)}`, row]));
    for (const row of decisions) {
      reviewedByKey.set(`${row.activity_id}|${secureUrl(row.original_image_url)}`, {
        activity_id: row.activity_id,
        activity_name: row.activity_name,
        original_image_url: row.original_image_url,
        selected: Boolean(row.replacement),
        reviewed_at: new Date().toISOString(),
      });
    }
    writeJson(freshReviewedPath, { generated_at: new Date().toISOString(), rows: [...reviewedByKey.values()] });
  }
  console.log(`Created ${decisions.length} replacement decisions: ${decisions.filter((row) => row.replacement).length} selected, ${decisions.filter((row) => !row.replacement).length} need a fresh search.`);
}

async function callImageFunction(body) {
  assertConfig(true);
  const response = await fetch(`${supabaseUrl}/functions/v1/cafe-image-importer`, {
    method: 'POST',
    headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`, 'Content-Type': 'application/json', 'x-tiny-outings-image-job-token': jobSecret },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(150000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Replacement writer returned ${response.status}.`);
  return payload;
}

async function apply(path) {
  const absolute = isAbsolute(path) ? path : resolve(root, path);
  const body = JSON.parse(readFileSync(absolute, 'utf8'));
  const decisions = (Array.isArray(body) ? body : body.decisions).filter((row) => row.replacement);
  const requests = decisions.map((row) => ({
    activity_id: row.activity_id,
    activity_ids: row.activity_ids,
    original_image_url: row.original_image_url,
    original_source_field: row.original_source_field,
    replacement_image_url: row.replacement.original_url,
    replacement_thumbnail_url: row.replacement.thumbnail_url,
    replacement_source_url: row.replacement.source_url,
    width: row.replacement.width,
    height: row.replacement.height,
    reason: row.reason,
    model,
    workflow_version: workflowVersion,
  }));
  const results = [];
  for (let offset = 0; offset < requests.length; offset += 20) {
    const payload = await callImageFunction({ card_image_replacements: requests.slice(offset, offset + 20) });
    results.push(...(payload.results || []));
    console.log(`Applied card-image replacements ${results.length}/${requests.length}.`);
  }
  writeJson(applyPath, { generated_at: new Date().toISOString(), results });
  const failed = results.filter((row) => row.status !== 'replaced');
  if (failed.length) throw new Error(`${failed.length} replacements failed to save.`);
}

function writeFreshSearchQueue() {
  let rejected = [];
  let missingGroups = [];
  try { rejected = JSON.parse(readFileSync(rejectedPath, 'utf8')).rows || []; } catch { /* no rejected rows */ }
  try { missingGroups = JSON.parse(readFileSync(missingPath, 'utf8')).groups || []; } catch { /* no missing rows */ }
  const activityIds = [...new Set([
    ...rejected.map((row) => row.activity_id),
    ...missingGroups.map((row) => row.activity_id),
  ].filter(Boolean))];
  writeJson(freshSearchPath, {
    generated_at: new Date().toISOString(),
    activity_ids: activityIds,
    rejected_candidate_groups: rejected.length,
    missing_candidate_groups: missingGroups.length,
  });
  console.log(`Created targeted fresh-search queue with ${activityIds.length} activity groups.`);
}

const operation = writeSearchQueue
  ? Promise.resolve(writeFreshSearchQueue())
  : applyDecisionPath
  ? apply(applyDecisionPath)
  : createValue
    ? Promise.resolve(createDecisions(createValue))
    : prepare();

operation.catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
