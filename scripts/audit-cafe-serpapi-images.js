/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assessCafeSerpApiPresentation,
  cafePresentationSummary,
  isCafeActivity,
} from './lib/scraped-image-audit-policy.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(root, 'data', 'cafe_serpapi_presentation_audit.generated.json');
const refreshPath = join(root, 'data', 'cafe_serpapi_presentation_refresh_candidates.generated.json');

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
const selectFields = 'activity_id,activity_name,category,scraped_image_url,image_source_url';

async function fetchActivities() {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const url = new URL(`${supabaseUrl}/rest/v1/activities`);
    url.searchParams.set('select', selectFields);
    url.searchParams.set('archive', 'eq.false');
    url.searchParams.set('public_listing_status', 'in.(draft,published)');
    url.searchParams.set('scraped_image_url', 'not.is.null');
    url.searchParams.set('order', 'activity_id.asc');
    url.searchParams.set('limit', '1000');
    url.searchParams.set('offset', String(offset));
    const response = await fetch(url, { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } });
    if (!response.ok) throw new Error(`Could not load activities: ${response.status}.`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function main() {
  const cafes = (await fetchActivities()).filter(isCafeActivity);
  const rows = cafes.map((activity) => ({
    activity_id: activity.activity_id,
    activity_name: activity.activity_name,
    category: activity.category,
    assessment: assessCafeSerpApiPresentation(activity),
  })).filter((row) => row.assessment);
  const summary = cafePresentationSummary(rows);
  const refreshIds = rows.filter((row) => row.assessment.outcome === 'refresh').map((row) => row.activity_id);
  const generatedAt = new Date().toISOString();
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify({
    generated_at: generatedAt,
    reviewed: rows.length,
    summary,
    rows,
  }, null, 2) + '\n');
  writeFileSync(refreshPath, JSON.stringify({ generated_at: generatedAt, activity_ids: refreshIds }, null, 2) + '\n');
  console.log(`Reviewed ${rows.length} cafe and food SerpAPI images.`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Interior or exterior refresh candidates: ${refreshIds.length}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
