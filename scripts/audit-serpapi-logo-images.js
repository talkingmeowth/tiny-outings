/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSerpApiLogoImage } from './lib/scraped-image-audit-policy.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const auditPath = join(root, 'data', 'serpapi_logo_image_audit.generated.json');
const candidatePath = join(root, 'data', 'serpapi_logo_image_refresh_candidates.generated.json');

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

async function fetchActivities() {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(`${supabaseUrl}/rest/v1/activities`);
    url.searchParams.set('select', 'activity_id,activity_name,category,scraped_image_url,image_source_url');
    url.searchParams.set('archive', 'eq.false');
    url.searchParams.set('public_listing_status', 'in.(draft,published)');
    url.searchParams.set('scraped_image_url', 'not.is.null');
    url.searchParams.set('order', 'activity_id.asc');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(pageSize));
    const response = await fetch(url, { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } });
    if (!response.ok) throw new Error(`Could not load activities: ${response.status}.`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function main() {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
  const activities = await fetchActivities();
  const logoRows = activities.filter(isSerpApiLogoImage).map((activity) => ({
    activity_id: activity.activity_id,
    activity_name: activity.activity_name,
    category: activity.category,
    image_source_url: activity.image_source_url,
  }));
  const generatedAt = new Date().toISOString();
  mkdirSync(dirname(auditPath), { recursive: true });
  writeFileSync(auditPath, JSON.stringify({
    generated_at: generatedAt,
    reviewed_count: activities.length,
    logo_count: logoRows.length,
    activities: logoRows,
  }, null, 2) + '\n');
  writeFileSync(candidatePath, JSON.stringify({
    generated_at: generatedAt,
    activity_ids: logoRows.map((row) => row.activity_id),
  }, null, 2) + '\n');
  console.log(`Reviewed ${activities.length} active SerpAPI image records; found ${logoRows.length} logo candidates.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
