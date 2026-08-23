/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assessScrapedImage,
  imageAuditSummary,
  refreshableScrapedImage,
} from './lib/scraped-image-audit-policy.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(root, 'data', 'scraped_image_suitability_audit.generated.json');
const refreshPath = join(root, 'data', 'scraped_image_refresh_candidates.generated.json');

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
const selectFields = [
  'activity_id', 'activity_name', 'category', 'description', 'website', 'organiser_website',
  'scraped_image_url', 'image_source_url', 'google_place_id', 'google_primary_type',
].join(',');

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
  const activities = await fetchActivities();
  const rows = activities.map((activity) => ({
    activity_id: activity.activity_id,
    activity_name: activity.activity_name,
    category: activity.category,
    assessment: assessScrapedImage(activity),
  }));
  const summary = imageAuditSummary(rows);
  const refreshCandidates = activities.filter(refreshableScrapedImage).map((activity) => activity.activity_id);
  const audit = {
    generated_at: new Date().toISOString(),
    method: 'provenance-and-Google-Places-identity audit',
    note: 'This automated audit checks objective source, quality, and Google Places identity signals. It does not download Google Places photos or use a vision model.',
    reviewed: activities.length,
    summary,
    refresh_candidate_count: refreshCandidates.length,
    rows,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(audit, null, 2) + '\n');
  writeFileSync(refreshPath, JSON.stringify({
    generated_at: audit.generated_at,
    activity_ids: refreshCandidates,
  }, null, 2) + '\n');
  console.log(`Reviewed ${activities.length} scraped images.`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Strong refresh candidates: ${refreshCandidates.length}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
