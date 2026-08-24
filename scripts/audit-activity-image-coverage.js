/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowsWikimediaImages, isWikimediaUrl } from '../src/wikimediaImagePolicy.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(root, 'data', 'activity_image_coverage.generated.json');
const linkedDatabase = process.argv.includes('--linked-database');
const imageFields = [
  'admin_cover_image_url',
  'user_image_url',
  'scraped_image_url',
  'organiser_website_downloaded_image',
  'website_downloaded_image',
  'wikimedia_image_url',
  'website_image_url',
  'listing_image_url',
  'image_url',
];

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
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
  const rows = [];
  const select = ['activity_id', 'category', 'image_source_url', 'serpapi_image_candidates', 'serpapi_image_candidates_fetched_at', 'serpapi_image_selected_at', ...imageFields].join(',');
  for (let offset = 0; ; offset += 1000) {
    const url = new URL(`${supabaseUrl}/rest/v1/activities`);
    url.searchParams.set('select', select);
    url.searchParams.set('archive', 'eq.false');
    url.searchParams.set('public_listing_status', 'in.(draft,published)');
    url.searchParams.set('order', 'activity_id.asc');
    url.searchParams.set('limit', '1000');
    url.searchParams.set('offset', String(offset));
    const response = await fetch(url, { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } });
    if (!response.ok) throw new Error(`Could not load image coverage: ${response.status}.`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function fetchActivitiesFromLinkedDatabase() {
  const select = ['activity_id', 'category', 'image_source_url', 'serpapi_image_candidates', 'serpapi_image_candidates_fetched_at', 'serpapi_image_selected_at', ...imageFields].join(',');
  const statement = `select ${select} from public.activities where coalesce(archive, false) = false and public_listing_status in ('draft', 'published');`;
  const escaped = statement.replaceAll('"', '\\"');
  const command = `npx${process.platform === 'win32' ? '.cmd' : ''} supabase db query --linked --output-format json "${escaped}"`;
  const output = execSync(command, {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    // Candidate sets can contain twenty result records each, so a full London
    // coverage report can legitimately exceed Node's default 1 MB buffer.
    maxBuffer: 50 * 1024 * 1024,
  });
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Could not read the linked database image coverage response.');
  const payload = JSON.parse(output.slice(start, end + 1));
  if (!Array.isArray(payload.rows)) throw new Error('Linked database image coverage returned no rows.');
  return payload.rows;
}

function present(value) {
  return Boolean(String(value || '').trim());
}

function presentForActivity(activity, field) {
  const imageUrl = activity[field];
  if (!present(imageUrl)) return false;
  if (allowsWikimediaImages(activity)) return true;
  if (field === 'wikimedia_image_url' || isWikimediaUrl(imageUrl)) return false;
  return field !== 'scraped_image_url' || !isWikimediaUrl(activity.image_source_url);
}

async function main() {
  const activities = linkedDatabase ? fetchActivitiesFromLinkedDatabase() : await fetchActivities();
  const perField = Object.fromEntries(imageFields.map((field) => [field, 0]));
  for (const activity of activities) {
    for (const field of imageFields) if (presentForActivity(activity, field)) perField[field] += 1;
  }
  const report = {
    generated_at: new Date().toISOString(),
    source: linkedDatabase ? 'linked_database' : 'public_api',
    active_or_queued: activities.length,
    with_any_image: activities.filter((activity) => imageFields.some((field) => presentForActivity(activity, field))).length,
    missing_all_images: activities.filter((activity) => imageFields.every((field) => !presentForActivity(activity, field))).length,
    serpapi_candidate_discovery_complete: activities.filter((activity) => present(activity.serpapi_image_candidates_fetched_at)).length,
    serpapi_candidate_sets_saved: activities.filter((activity) => Array.isArray(activity.serpapi_image_candidates) && activity.serpapi_image_candidates.length > 0).length,
    serpapi_selection_complete: activities.filter((activity) => present(activity.serpapi_image_selected_at)).length,
    image_field_coverage: perField,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
