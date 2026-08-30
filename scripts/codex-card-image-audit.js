/* global process */
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { activityImageGroupKey } from '../src/activityDuplicates.js';
import { shareListingImages } from '../src/activityImages.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(root, 'data', 'codex_card_image_audit_manifest.generated.json');
const decisionsPath = join(root, 'data', 'codex_card_image_audit_decisions.generated.json');
const applyPath = join(root, 'data', 'codex_card_image_audit_apply.generated.json');
const cacheRoot = join(root, 'data', 'codex-card-image-audit-cache');
const sheetRoot = join(root, 'data', 'codex-card-image-audit-sheets');
const model = 'gpt-5.6-sol';
const workflowVersion = 'codex-card-image-audit-v1';
const limitIndex = process.argv.indexOf('--limit');
const limit = limitIndex >= 0 ? Math.max(1, Number(process.argv[limitIndex + 1]) || 1) : 160;
const sheetSizeIndex = process.argv.indexOf('--sheet-size');
const sheetSize = sheetSizeIndex >= 0 ? Math.min(16, Math.max(4, Number(process.argv[sheetSizeIndex + 1]) || 16)) : 16;
const createIndex = process.argv.indexOf('--create-decisions');
const createValue = createIndex >= 0 ? process.argv[createIndex + 1] || null : null;
const validateIndex = process.argv.indexOf('--validate-decisions');
const validatePath = validateIndex >= 0 ? process.argv[validateIndex + 1] || null : null;
const applyIndex = process.argv.indexOf('--apply');
const decisionApplyPath = applyIndex >= 0 ? process.argv[applyIndex + 1] || null : null;
const applyOffsetIndex = process.argv.indexOf('--apply-offset');
const applyOffset = applyOffsetIndex >= 0 ? Number(process.argv[applyOffsetIndex + 1] || 0) : 0;

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
  if (!supabaseUrl || !supabaseAnonKey || (forWrite && !jobSecret)) {
    throw new Error('Missing Supabase configuration or TINY_OUTINGS_IMAGE_JOB_SECRET.');
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
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

function xml(value) {
  return String(value || '').replace(/[<>&'"]/g, (character) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  })[character]);
}

function short(value, maximum) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`;
}

async function fetchActivities() {
  assertConfig();
  const fields = [
    'activity_id', 'activity_name', 'address', 'postcode', 'borough', 'category', 'description',
    'website', 'organiser_website', 'source_url', 'updated_at', 'created_at',
    'admin_cover_image_url', 'reviewed_image_url', 'use_category_image', 'user_image_url', 'model_selected_url', 'audit_image_url', 'audit_image_source_url',
    'scraped_image_url', 'image_source_url', 'organiser_website_downloaded_image',
    'website_downloaded_image', 'wikimedia_image_url', 'website_image_url',
    'listing_image_url', 'image_url', 'audit_image_reviewed_at', 'audit_image_status',
    'audit_image_original_url', 'audit_image_original_source_field',
  ].join(',');
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const url = new URL(`${supabaseUrl}/rest/v1/activities`);
    url.searchParams.set('select', fields);
    url.searchParams.set('archive', 'eq.false');
    url.searchParams.set('public_listing_status', 'in.(draft,published)');
    url.searchParams.set('order', 'activity_id.asc');
    url.searchParams.set('limit', '1000');
    url.searchParams.set('offset', String(offset));
    const response = await fetch(url, { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } });
    if (!response.ok) throw new Error(`Could not load activity images: ${response.status} ${await response.text()}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function currentAuditComplete(activity, sourceUrl, sourceField) {
  if (sourceField === 'audit_image_url') {
    return activity.audit_image_status === 'replaced' && activity.audit_image_url === sourceUrl;
  }
  return Boolean(activity.audit_image_reviewed_at
    && activity.audit_image_original_url === sourceUrl
    && activity.audit_image_original_source_field === sourceField);
}

function auditQueue(activities) {
  const shared = shareListingImages(activities);
  const groups = new Map();
  for (const activity of shared) {
    const key = activityImageGroupKey(activity);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(activity);
  }
  const queue = [];
  for (const members of groups.values()) {
    const representative = members[0];
    const sourceUrl = representative.shared_card_image_url || null;
    const sourceField = representative.shared_card_image_source || null;
    if (!sourceUrl || !sourceField || ['admin_cover_image_url', 'category_placeholder'].includes(sourceField)) continue;
    if (members.every((member) => currentAuditComplete(member, sourceUrl, sourceField))) continue;
    queue.push({
      ...representative,
      activity_ids: members.map((member) => member.activity_id),
      selected_image_url: sourceUrl,
      selected_image_source_field: sourceField,
    });
  }
  return queue.sort((left, right) => String(left.activity_id).localeCompare(String(right.activity_id)));
}

async function downloadImage(activity) {
  const hash = createHash('sha1').update(activity.selected_image_url).digest('hex');
  const cachePath = join(cacheRoot, `${hash}.jpg`);
  if (existsSync(cachePath)) {
    const metadata = await sharp(cachePath).metadata();
    return { cache_path: cachePath, width: metadata.width || null, height: metadata.height || null };
  }
  mkdirSync(cacheRoot, { recursive: true });
  const response = await fetch(activity.selected_image_url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
  });
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!response.ok || !contentType.startsWith('image/')) throw new Error(`download returned ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('image exceeds 10 MB');
  const source = sharp(bytes, { failOn: 'none' }).rotate();
  const metadata = await source.metadata();
  await source.jpeg({ quality: 88, mozjpeg: true }).toFile(cachePath);
  return { cache_path: cachePath, width: metadata.width || null, height: metadata.height || null };
}

function automaticFailure(activity, image) {
  const metadata = `${activity.selected_image_url} ${activity.image_source_url || ''}`;
  if (/favicon|icon|logo|wordmark|brandmark|sprite|avatar|badge/i.test(metadata)) return 'icon_or_logo_metadata';
  if (!image.cache_path) return 'image_download_failed';
  const width = Number(image.width || 0);
  const height = Number(image.height || 0);
  if (!width || !height || Math.min(width, height) < 300 || width * height < 180000) return 'low_resolution';
  if (width / height < 0.35 || width / height > 3.2) return 'extreme_aspect_ratio';
  return null;
}

async function makeTile(row) {
  const width = 600;
  const height = 500;
  const imageHeight = 340;
  const base = sharp({ create: { width, height, channels: 3, background: '#f4f1e9' } });
  const composites = [];
  if (row.cache_path) {
    const image = await sharp(row.cache_path)
      .resize(width - 16, imageHeight - 16, { fit: 'contain', background: '#ddd8ce' })
      .jpeg({ quality: 84 })
      .toBuffer();
    composites.push({ input: image, left: 8, top: 8 });
  }
  const dimensions = row.width && row.height ? `${row.width}×${row.height}` : 'unavailable';
  const warning = row.automatic_failure ? `PRECHECK FAIL: ${row.automatic_failure}` : 'VISION CHECK: accuracy / essence / quality';
  const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${row.cache_path ? '' : '<rect x="8" y="8" width="584" height="324" rx="8" fill="#d8d3c8"/><text x="300" y="175" text-anchor="middle" font-family="Arial" font-size="24" fill="#5b6264">IMAGE UNAVAILABLE</text>'}
    <rect x="8" y="8" width="104" height="36" rx="6" fill="#122f33" fill-opacity="0.94"/>
    <text x="18" y="34" font-family="Arial" font-size="23" font-weight="700" fill="#fff">${String(row.ordinal).padStart(4, '0')}</text>
    <rect x="0" y="340" width="600" height="160" fill="#173f43"/>
    <text x="14" y="370" font-family="Arial" font-size="22" font-weight="700" fill="#fff">${xml(short(row.activity_name, 47))}</text>
    <text x="14" y="397" font-family="Arial" font-size="17" fill="#d8eeee">${xml(short(`${row.category || 'Uncategorised'} · ${row.selected_image_source_field}`, 68))}</text>
    <text x="14" y="423" font-family="Arial" font-size="16" fill="#d8eeee">${xml(short(`${dimensions} · ${row.address || row.borough || 'London'}`, 74))}</text>
    <text x="14" y="458" font-family="Arial" font-size="16" font-weight="700" fill="${row.automatic_failure ? '#ffd08a' : '#b9e2ce'}">${xml(warning)}</text>
    <text x="14" y="482" font-family="Arial" font-size="14" fill="#c7d6d7">Codes: p=pass, a=accuracy fail, e=essence fail, q=quality fail</text>
  </svg>`);
  composites.push({ input: overlay, left: 0, top: 0 });
  return base.composite(composites).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
}

async function buildSheets(rows) {
  mkdirSync(sheetRoot, { recursive: true });
  const outputs = [];
  const columns = 4;
  for (let start = 0; start < rows.length; start += sheetSize) {
    const batch = rows.slice(start, start + sheetSize);
    const tiles = await Promise.all(batch.map(makeTile));
    const rowCount = Math.ceil(batch.length / columns);
    const output = join(sheetRoot, `review-${String(batch[0].ordinal).padStart(4, '0')}-${String(batch.at(-1).ordinal).padStart(4, '0')}.jpg`);
    await sharp({ create: { width: columns * 600, height: rowCount * 500, channels: 3, background: '#f4f1e9' } })
      .composite(tiles.map((input, index) => ({ input, left: (index % columns) * 600, top: Math.floor(index / columns) * 500 })))
      .jpeg({ quality: 86, mozjpeg: true })
      .toFile(output);
    outputs.push({ first: batch[0].ordinal, last: batch.at(-1).ordinal, path: output });
  }
  return outputs;
}

async function prepare() {
  const activities = await fetchActivities();
  const allPending = auditQueue(activities);
  const pending = allPending.slice(0, limit);
  let completed = 0;
  const prepared = await mapWithConcurrency(pending, 8, async (activity, index) => {
    let image = { cache_path: null, width: null, height: null };
    let downloadError = null;
    try {
      image = await downloadImage(activity);
    } catch (error) {
      downloadError = error instanceof Error ? error.message : String(error);
    }
    const row = {
      ordinal: index + 1,
      ...activity,
      ...image,
      download_error: downloadError,
    };
    row.automatic_failure = automaticFailure(activity, row);
    completed += 1;
    if (completed % 20 === 0 || completed === pending.length) console.log(`Prepared card audit ${completed}/${pending.length}.`);
    return row;
  });
  const sheets = pending.length ? await buildSheets(prepared) : [];
  writeJson(manifestPath, {
    generated_at: new Date().toISOString(), provider: 'codex', model, workflow_version: workflowVersion,
    total_visible_activities: activities.length,
    pending_card_groups: allPending.length,
    prepared: prepared.length,
    excluded_admin_or_missing: activities.length - allPending.length,
    instructions: 'Inspect every selected card image. Use p only when it is accurate, captures the activity essence, and is good quality. Otherwise combine a, e, and q for every failed criterion. Logos and icons must include e and q. Low-resolution images must include q.',
    sheets,
    activities: prepared.map((row) => ({
      ordinal: row.ordinal,
      activity_id: row.activity_id,
      activity_ids: row.activity_ids,
      activity_name: row.activity_name,
      category: row.category,
      address: row.address,
      selected_image_url: row.selected_image_url,
      selected_image_source_field: row.selected_image_source_field,
      width: row.width,
      height: row.height,
      automatic_failure: row.automatic_failure,
      download_error: row.download_error,
    })),
  });
  console.log(`Prepared ${prepared.length} card groups on ${sheets.length} contact sheets; ${allPending.length} groups remain including this batch.`);
}

function decisionsFrom(path) {
  const absolute = isAbsolute(path) ? path : resolve(root, path);
  const body = JSON.parse(readFileSync(absolute, 'utf8'));
  const rows = Array.isArray(body) ? body : body.decisions;
  if (!Array.isArray(rows) || !rows.length) throw new Error('Decision file must contain decisions.');
  return rows;
}

function createDecisions(value) {
  if (!value) throw new Error('--create-decisions requires comma-separated p/a/e/q combinations.');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const choices = value.split(',').map((choice) => choice.trim().toLowerCase());
  if (choices.length !== manifest.activities.length) throw new Error(`Expected ${manifest.activities.length} choices but received ${choices.length}.`);
  const decisions = manifest.activities.map((activity, index) => {
    const automatic = activity.automatic_failure;
    const manualCode = choices[index];
    if (manualCode !== 'p' && !/^(?!.*(.).*\1)[aeq]{1,3}$/.test(manualCode)) throw new Error(`Invalid choice ${index + 1}: ${manualCode}`);
    const code = manualCode === 'p' && automatic
      ? automatic === 'icon_or_logo_metadata' ? 'eq' : 'q'
      : manualCode;
    const accurate = code === 'p' || !code.includes('a');
    const capturesEssence = code === 'p' || !code.includes('e');
    const goodQuality = code === 'p' || !code.includes('q');
    const failed = [!accurate && 'inaccurate', !capturesEssence && 'does not capture the activity essence', !goodQuality && 'poor quality'].filter(Boolean);
    return {
      ...activity,
      accurate,
      captures_essence: capturesEssence,
      good_quality: goodQuality,
      reason: automatic
        ? `Codex full-card review: ${automatic}; ${failed.join('; ')}.`
        : code === 'p'
          ? 'Codex full-card review: accurate, representative, and good quality.'
          : `Codex full-card review: ${failed.join('; ')}.`,
      model,
      workflow_version: workflowVersion,
    };
  });
  writeJson(decisionsPath, { generated_at: new Date().toISOString(), decisions });
  const failed = decisions.filter((row) => !(row.accurate && row.captures_essence && row.good_quality)).length;
  console.log(`Created ${decisions.length} card-image decisions: ${decisions.length - failed} passed, ${failed} need replacement.`);
}

function validate(path) {
  const rows = decisionsFrom(path);
  for (const [index, row] of rows.entries()) {
    if (!row.activity_id || !Array.isArray(row.activity_ids) || !row.activity_ids.length) throw new Error(`Decision ${index + 1} has no activity group.`);
    if (!row.selected_image_url || !row.selected_image_source_field) throw new Error(`Decision ${index + 1} has no selected image identity.`);
    for (const field of ['accurate', 'captures_essence', 'good_quality']) if (typeof row[field] !== 'boolean') throw new Error(`Decision ${index + 1} lacks ${field}.`);
    if (!String(row.reason || '').trim()) throw new Error(`Decision ${index + 1} has no reason.`);
  }
  console.log(`Validated ${rows.length} full card-image audit decisions.`);
  return rows;
}

async function callImageFunction(body) {
  assertConfig(true);
  const response = await fetch(`${supabaseUrl}/functions/v1/cafe-image-importer`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
      'x-tiny-outings-image-job-token': jobSecret,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(150000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Image function returned ${response.status}.`);
  return payload;
}

async function apply(path) {
  const allDecisions = validate(path);
  if (!Number.isInteger(applyOffset) || applyOffset < 0 || applyOffset > allDecisions.length) {
    throw new Error(`--apply-offset must be an integer from 0 to ${allDecisions.length}.`);
  }
  const decisions = allDecisions.slice(applyOffset);
  const results = [];
  for (let offset = 0; offset < decisions.length; offset += 20) {
    const payload = await callImageFunction({ card_image_audits: decisions.slice(offset, offset + 20) });
    results.push(...(payload.results || []));
    console.log(`Applied full card-image audits ${applyOffset + results.length}/${allDecisions.length}.`);
  }
  writeJson(applyPath, { generated_at: new Date().toISOString(), results });
  const failures = results.filter((row) => row.status === 'audit-failed');
  if (failures.length) throw new Error(`${failures.length} card-image audits failed to save.`);
}

const operation = decisionApplyPath
  ? apply(decisionApplyPath)
  : validatePath
    ? Promise.resolve(validate(validatePath))
    : createValue
      ? Promise.resolve(createDecisions(createValue))
      : prepare();

operation.catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
