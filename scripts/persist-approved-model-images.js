/* global process */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { imageDbQuery } from './lib/image-chat-db.js';

const root = resolve(import.meta.dirname, '..');
function readEnv() {
  try {
    return Object.fromEntries(readFileSync(resolve(root, '.env.local'), 'utf8')
      .split(/\r?\n/).filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
      }));
  } catch { return {}; }
}

const local = readEnv();
const supabaseUrl = process.env.VITE_SUPABASE_URL || local.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || local.VITE_SUPABASE_ANON_KEY;
const jobToken = process.env.TINY_OUTINGS_IMAGE_JOB_SECRET || local.TINY_OUTINGS_IMAGE_JOB_SECRET;
const limitAt = process.argv.indexOf('--limit');
const limit = limitAt >= 0 ? Math.max(1, Number(process.argv[limitAt + 1]) || 1) : Infinity;
const concurrencyAt = process.argv.indexOf('--concurrency');
const concurrency = concurrencyAt >= 0 ? Math.min(6, Math.max(1, Number(process.argv[concurrencyAt + 1]) || 3)) : 3;
const projectHost = new URL(supabaseUrl).hostname.replaceAll('.', '[.]');

function externalApprovedUrls() {
  return imageDbQuery(root, `select distinct chosen_image->>'image_url' as image_url
    from public.activity_image_model_proposals
    where decision='approved'
      and chosen_image->>'image_url' ~* '^https?://'
      and chosen_image->>'image_url' !~ '^https://${projectHost}/storage/v1/object/public/activity-images/'
    order by image_url`);
}

async function persist(items) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/image-model-review`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
          'x-tiny-outings-image-job-token': jobToken,
        },
        body: JSON.stringify({ action: 'persist_approved_urls', items }),
        signal: AbortSignal.timeout(120000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(payload.error || `Persistence endpoint returned ${response.status}.`);
      return payload.results || [];
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  return items.map((item) => ({ ...item, status: 'failed', error: lastError?.message || 'Request failed.' }));
}

async function persistPayload(imageUrl) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(imageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 TinyOutingsApprovedImageArchive/1.0', Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5' },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw Error(`Source returned ${response.status}.`);
      const original = Buffer.from(await response.arrayBuffer());
      if (original.length > 30 * 1024 * 1024) throw Error('Source image exceeded 30 MB.');
      const { data } = await sharp(original).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 84, effort: 4 }).toBuffer({ resolveWithObject: true });
      const stored = await fetch(`${supabaseUrl}/functions/v1/image-model-review`, {
        method: 'POST',
        headers: {
          apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json',
          'x-tiny-outings-image-job-token': jobToken,
        },
        body: JSON.stringify({ action: 'persist_approved_payloads', items: [{
          image_url: imageUrl, image_base64: data.toString('base64'), mime_type: 'image/webp',
        }] }),
        signal: AbortSignal.timeout(120000),
      });
      const payload = await stored.json().catch(() => ({}));
      const result = payload.results?.[0];
      if (!stored.ok || result?.status !== 'stored') throw Error(result?.error || payload.error || `Payload endpoint returned ${stored.status}.`);
      return result;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  return { image_url: imageUrl, status: 'failed', error: lastError?.message || 'Local fallback failed.' };
}

if (!supabaseUrl || !anonKey || !jobToken) throw Error('Missing Supabase configuration or image job token.');
const urls = externalApprovedUrls().slice(0, limit);
const batches = [];
for (let index = 0; index < urls.length; index += 6) batches.push(urls.slice(index, index + 6));
const totals = { targeted: urls.length, stored: 0, failed: 0, updated: 0 };
let cursor = 0;
async function worker() {
  while (cursor < batches.length) {
    const batchNumber = cursor++;
    const results = await persist(batches[batchNumber]);
    for (const result of results) {
      if (result.status === 'stored' || result.status === 'already_stored') totals.stored += 1;
      else totals.failed += 1;
      totals.updated += Number(result.updated || 0);
      if (result.status === 'failed') console.error(`Failed ${result.image_url}: ${result.error}`);
    }
    console.log(`Approved image storage ${batchNumber + 1}/${batches.length}: ${totals.stored} stored, ${totals.failed} failed.`);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, batches.length || 1) }, worker));
if (!process.argv.includes('--no-local-fallback')) {
  const remaining = externalApprovedUrls();
  for (const [index, row] of remaining.entries()) {
    const result = await persistPayload(row.image_url);
    if (result.status === 'stored') {
      totals.stored += 1;
      totals.updated += Number(result.updated || 0);
      totals.failed = Math.max(0, totals.failed - 1);
    } else {
      console.error(`Local fallback failed ${row.image_url}: ${result.error}`);
    }
    console.log(`Approved image local fallback ${index + 1}/${remaining.length}.`);
  }
}
totals.remaining_external_unique_urls = externalApprovedUrls().length;
console.log(JSON.stringify(totals));
