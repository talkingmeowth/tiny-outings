/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, RawImage } from '@huggingface/transformers';
import {
  CAFE_IMAGE_CONTENT_LABELS,
  assessCafeImageContent,
  cafeImageContentSummary,
} from './lib/cafe-image-content-policy.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(root, 'data', 'cafe_serpapi_visual_audit.generated.json');
const refreshPath = join(root, 'data', 'cafe_serpapi_visual_refresh_candidates.generated.json');
const modelId = process.env.TINY_OUTINGS_CAFE_IMAGE_MODEL || 'Xenova/clip-vit-base-patch32';
const start = process.argv.includes('--start');
const limitIndex = process.argv.indexOf('--limit');
const limit = limitIndex >= 0 ? Math.max(1, Number(process.argv[limitIndex + 1]) || 1) : Number.POSITIVE_INFINITY;

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

function readPreviousAudit() {
  if (start) return { rows: [], resume_cursor: null };
  try {
    const previous = JSON.parse(readFileSync(outputPath, 'utf8'));
    return { rows: Array.isArray(previous.rows) ? previous.rows : [], resume_cursor: previous.resume_cursor || null };
  } catch {
    return { rows: [], resume_cursor: null };
  }
}

const localEnv = readDotEnv('.env.local');
const supabaseUrl = process.env.VITE_SUPABASE_URL || localEnv.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || localEnv.VITE_SUPABASE_ANON_KEY;

async function fetchActivities() {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const url = new URL(`${supabaseUrl}/rest/v1/activities`);
    url.searchParams.set('select', 'activity_id,activity_name,category,scraped_image_url,image_source_url');
    url.searchParams.set('archive', 'eq.false');
    url.searchParams.set('public_listing_status', 'in.(draft,published)');
    url.searchParams.set('scraped_image_url', 'not.is.null');
    url.searchParams.set('or', '(category.ilike.%cafe%,category.ilike.%food%)');
    url.searchParams.set('order', 'activity_id.asc');
    url.searchParams.set('limit', '1000');
    url.searchParams.set('offset', String(offset));
    const response = await fetch(url, { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } });
    if (!response.ok) throw new Error(`Could not load cafe activities: ${response.status}.`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function writeAudit(rows, resumeCursor, total) {
  const generatedAt = new Date().toISOString();
  const summary = cafeImageContentSummary(rows);
  const refreshIds = rows.filter((row) => row.assessment.outcome === 'refresh').map((row) => row.activity_id);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify({
    generated_at: generatedAt,
    model: modelId,
    reviewed: rows.length,
    total,
    resume_cursor: resumeCursor,
    summary,
    rows,
  }, null, 2) + '\n');
  writeFileSync(refreshPath, JSON.stringify({ generated_at: generatedAt, activity_ids: refreshIds }, null, 2) + '\n');
  return { summary, refreshIds };
}

async function loadImageForReview(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!response.ok || !contentType.startsWith('image/')) {
    throw new Error(`Image download returned ${response.status || 'an invalid'} response.`);
  }
  return RawImage.fromBlob(await response.blob());
}

async function main() {
  const activities = await fetchActivities();
  const previous = readPreviousAudit();
  const reviewed = new Map(previous.rows.map((row) => [row.activity_id, row]));
  const remaining = activities.filter((activity) => !reviewed.has(activity.activity_id)).slice(0, limit);
  if (!remaining.length) {
    const { summary, refreshIds } = writeAudit([...reviewed.values()], null, activities.length);
    console.log(`Visual audit already complete for ${activities.length} cafe images.`);
    console.log(JSON.stringify({ ...summary, refresh_candidates: refreshIds.length }, null, 2));
    return;
  }

  console.log(`Loading local vision model ${modelId} to inspect ${remaining.length} cafe images.`);
  const classifier = await pipeline('zero-shot-image-classification', modelId, { cache_dir: join(root, 'node_modules', '.cache', 'tiny-outings-vision'), dtype: 'q4' });
  for (let index = 0; index < remaining.length; index += 1) {
    const activity = remaining[index];
    try {
      const image = await loadImageForReview(activity.scraped_image_url);
      const labels = await classifier(image, CAFE_IMAGE_CONTENT_LABELS, {
        hypothesis_template: 'This image shows {}.',
      });
      reviewed.set(activity.activity_id, {
        activity_id: activity.activity_id,
        activity_name: activity.activity_name,
        category: activity.category,
        assessment: assessCafeImageContent(labels),
      });
    } catch (error) {
      reviewed.set(activity.activity_id, {
        activity_id: activity.activity_id,
        activity_name: activity.activity_name,
        category: activity.category,
        assessment: { outcome: 'failed', reason: error instanceof Error ? error.message : 'Image analysis failed.' },
      });
    }
    if ((index + 1) % 10 === 0 || index + 1 === remaining.length) {
      const next = remaining[index + 1]?.activity_id || null;
      const { summary, refreshIds } = writeAudit([...reviewed.values()], next, activities.length);
      console.log(`Visual image audit ${index + 1}/${remaining.length}: ${refreshIds.length} food or graphic replacements queued. ${JSON.stringify(summary)}`);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
