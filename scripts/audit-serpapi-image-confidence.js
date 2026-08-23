/* global process */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, RawImage } from '@huggingface/transformers';
import {
  assessSerpApiImageConfidence,
  labelsForSerpApiImageAudit,
  serpApiImageAuditSummary,
  sourceConfidence,
} from './lib/serpapi-image-confidence-policy.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(root, 'data', 'serpapi_image_confidence_audit.generated.json');
const outputSql = join(root, 'supabase', 'seed', 'activity_serpapi_image_confidence_removals.generated.sql');
const modelId = process.env.TINY_OUTINGS_SERPAPI_IMAGE_MODEL || 'Xenova/clip-vit-base-patch32';
const start = process.argv.includes('--start');
const linkedDatabase = process.argv.includes('--linked-database');
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

const localEnv = readDotEnv('.env.local');
const supabaseUrl = process.env.VITE_SUPABASE_URL || localEnv.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || localEnv.VITE_SUPABASE_ANON_KEY;

function readPreviousAudit() {
  if (start || !existsSync(outputPath)) return { rows: [] };
  try {
    const previous = JSON.parse(readFileSync(outputPath, 'utf8'));
    return { rows: Array.isArray(previous.rows) ? previous.rows : [] };
  } catch {
    return { rows: [] };
  }
}

async function fetchActivities() {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
  const rows = [];
  const select = 'activity_id,activity_name,category,website,organiser_website,scraped_image_url,image_source_url,serpapi_image_checked_at';
  for (let offset = 0; ; offset += 1000) {
    const url = new URL(`${supabaseUrl}/rest/v1/activities`);
    url.searchParams.set('select', select);
    url.searchParams.set('archive', 'eq.false');
    url.searchParams.set('public_listing_status', 'in.(draft,published)');
    url.searchParams.set('scraped_image_url', 'not.is.null');
    url.searchParams.set('serpapi_image_checked_at', 'not.is.null');
    url.searchParams.set('order', 'activity_id.asc');
    url.searchParams.set('limit', '1000');
    url.searchParams.set('offset', String(offset));
    const response = await fetch(url, { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } });
    if (!response.ok) throw new Error(`Could not load SerpAPI images: ${response.status}.`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function fetchActivitiesFromLinkedDatabase() {
  const select = 'activity_id,activity_name,category,website,organiser_website,scraped_image_url,image_source_url,serpapi_image_checked_at';
  const statement = `select ${select} from public.activities where coalesce(archive, false) = false and public_listing_status in ('draft', 'published') and scraped_image_url is not null and serpapi_image_checked_at is not null order by activity_id asc;`;
  const escapedStatement = statement.replaceAll('"', '\\"');
  const command = `npx${process.platform === 'win32' ? '.cmd' : ''} supabase db query --linked --output-format json "${escapedStatement}"`;
  const output = execSync(command, {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const startIndex = output.indexOf('{');
  const endIndex = output.lastIndexOf('}');
  if (startIndex < 0 || endIndex < startIndex) throw new Error('Could not read the linked database image audit response.');
  const payload = JSON.parse(output.slice(startIndex, endIndex + 1));
  if (!Array.isArray(payload.rows)) throw new Error('Linked database image audit returned no rows.');
  return payload.rows;
}

async function loadImage(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().startsWith('image/')) {
    throw new Error(`Image download returned ${response.status || 'an invalid'} response.`);
  }
  return RawImage.fromBlob(await response.blob());
}

function sql(value) {
  return `$$${String(value).replaceAll('$$', '$ $')}$$`;
}

function writeAudit(rows, total, resumeCursor) {
  // A failed fetch or decode has no visual evidence. It must not remain in the
  // primary SerpAPI image field under a high-confidence-only policy.
  const removals = rows.filter((row) => row.assessment.outcome !== 'retain');
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    model: modelId,
    reviewed: rows.length,
    total,
    resume_cursor: resumeCursor,
    summary: serpApiImageAuditSummary(rows),
    rows,
  }, null, 2) + '\n');
  writeFileSync(outputSql, removals.length
    ? `-- Generated by scripts/audit-serpapi-image-confidence.js\n-- Remove low-confidence SerpAPI images so the app falls back to the next trusted image field.\nupdate public.activities\nset scraped_image_url = null,\n    image_source_url = null,\n    updated_at = now()\nwhere activity_id in (\n  ${removals.map((row) => `${sql(row.activity_id)}::uuid`).join(',\n  ')}\n)\n  and coalesce(archive, false) = false;\n`
    : '-- No low-confidence SerpAPI images found.\n');
  return removals;
}

async function main() {
  const activities = linkedDatabase ? fetchActivitiesFromLinkedDatabase() : await fetchActivities();
  const previous = readPreviousAudit();
  const reviewed = new Map(previous.rows.map((row) => [row.activity_id, row]));
  const remaining = activities.filter((activity) => !reviewed.has(activity.activity_id)).slice(0, limit);
  if (!remaining.length) {
    const removals = writeAudit([...reviewed.values()], activities.length, null);
    console.log(`Image-confidence audit is complete for ${activities.length} SerpAPI images; ${removals.length} will be removed.`);
    return;
  }

  console.log(`Loading local vision model ${modelId} to review ${remaining.length} SerpAPI images.`);
  const classifier = await pipeline('zero-shot-image-classification', modelId, {
    cache_dir: join(root, 'node_modules', '.cache', 'tiny-outings-vision'),
    dtype: 'q4',
  });
  for (let index = 0; index < remaining.length; index += 1) {
    const activity = remaining[index];
    try {
      const source = sourceConfidence(activity);
      if (!source.highConfidence) {
        reviewed.set(activity.activity_id, {
          activity_id: activity.activity_id,
          activity_name: activity.activity_name,
          category: activity.category,
          assessment: {
            outcome: 'remove',
            reason: 'Image provenance does not contain enough distinctive activity evidence.',
            source,
            accepted_score: null,
            rejected_score: null,
          },
        });
      } else {
        const labels = labelsForSerpApiImageAudit(activity);
        const image = await loadImage(activity.scraped_image_url);
        const results = await classifier(image, labels, { hypothesis_template: 'This image shows {}.' });
        reviewed.set(activity.activity_id, {
          activity_id: activity.activity_id,
          activity_name: activity.activity_name,
          category: activity.category,
          assessment: assessSerpApiImageConfidence(activity, results),
        });
      }
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
      const removals = writeAudit([...reviewed.values()], activities.length, next);
      console.log(`Image confidence audit ${index + 1}/${remaining.length}; ${removals.length} low-confidence images queued.`);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
