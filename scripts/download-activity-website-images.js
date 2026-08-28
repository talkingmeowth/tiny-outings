/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(root, 'data', 'activity_website_image_downloads.generated.json');
const batchSize = Math.min(Math.max(Number(process.env.ACTIVITY_IMAGE_DOWNLOAD_BATCH_SIZE || 20), 1), 25);
const limitIndex = process.argv.indexOf('--limit');
const maxActivities = Math.max(Number(limitIndex >= 0 ? process.argv[limitIndex + 1] : process.env.ACTIVITY_IMAGE_DOWNLOAD_LIMIT || 1200), 1);
const linkedDatabase = process.argv.includes('--linked-database');
const reselectDownloaded = process.argv.includes('--reselect-downloaded');
const createdAfterIndex = process.argv.indexOf('--created-after');
const createdAfter = createdAfterIndex >= 0 ? process.argv[createdAfterIndex + 1] || null : null;

function readDotEnv(name) {
  try {
    const path = process.env.TINY_OUTINGS_ENV_FILE ? resolve(process.env.TINY_OUTINGS_ENV_FILE) : join(root, name);
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

const localEnv = readDotEnv('.env.local');
const supabaseUrl = process.env.VITE_SUPABASE_URL || localEnv.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || localEnv.VITE_SUPABASE_ANON_KEY;
const jobSecret = process.env.TINY_OUTINGS_IMAGE_JOB_SECRET || localEnv.TINY_OUTINGS_IMAGE_JOB_SECRET;

function usableUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

async function fetchActivities() {
  const columns = [
    'activity_id', 'activity_name', 'category', 'website', 'organiser_website', 'source_url', 'created_at',
    'image_url', 'scraped_image_url', 'website_image_url', 'listing_image_url',
    'wikimedia_image_url', 'user_image_url', 'admin_cover_image_url',
    'website_downloaded_image', 'organiser_website_downloaded_image', 'website_image_candidates_fetched_at', 'website_image_vision_candidates_fetched_at',
  ].join(',');
  const activities = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/activities?select=${columns}&public_listing_status=in.(draft,published)&archive=eq.false&order=activity_id.asc&limit=1000&offset=${offset}`,
      { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } },
    );
    if (!response.ok) throw new Error(`Could not read activities: ${response.status} ${await response.text()}`);
    const page = await response.json();
    activities.push(...page);
    if (page.length < 1000) return activities;
  }
}

function fetchActivitiesFromLinkedDatabase() {
  const columns = [
    'activity_id', 'activity_name', 'category', 'website', 'organiser_website', 'source_url', 'created_at',
    'image_url', 'scraped_image_url', 'website_image_url', 'listing_image_url',
    'wikimedia_image_url', 'user_image_url', 'admin_cover_image_url',
    'website_downloaded_image', 'organiser_website_downloaded_image', 'website_image_candidates_fetched_at', 'website_image_vision_candidates_fetched_at',
  ].join(',');
  const statement = `select ${columns} from public.activities where coalesce(archive, false) = false and public_listing_status in ('draft', 'published') order by activity_id asc;`;
  const escaped = statement.replaceAll('"', '\\"');
  const command = `npx${process.platform === 'win32' ? '.cmd' : ''} supabase db query --linked --output-format json "${escaped}"`;
  const output = execSync(command, {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 50 * 1024 * 1024,
  });
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Could not read linked database activities.');
  const payload = JSON.parse(output.slice(start, end + 1));
  if (!Array.isArray(payload.rows)) throw new Error('Linked database returned no activity rows.');
  return payload.rows;
}

async function invokeDownloader(activityIds) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/activity-website-image-downloader`, {
        method: 'POST',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
          'x-tiny-outings-image-job-token': jobSecret,
        },
        body: JSON.stringify({ activity_ids: activityIds }),
        signal: AbortSignal.timeout(120000),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
        throw new Error(payload.error || `Image downloader returned ${response.status}.`);
      }
    } catch (error) {
      if (attempt === 3) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error('Image downloader did not return a result.');
}

async function main() {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
  if (!jobSecret) throw new Error('Missing TINY_OUTINGS_IMAGE_JOB_SECRET. The manual downloader cannot run without its server-side job token.');

  const activities = linkedDatabase ? fetchActivitiesFromLinkedDatabase() : await fetchActivities();
  const eligible = activities.filter((activity) => {
    const hasWebsiteSource = [activity.organiser_website, activity.website, activity.source_url].some(usableUrl);
    if (!hasWebsiteSource) return false;
    if (reselectDownloaded) {
      const hasDownloadedImage = [activity.organiser_website_downloaded_image, activity.website_downloaded_image].some(usableUrl);
      const currentSetAlreadyReviewed = activity.website_image_candidates_fetched_at
        && Date.parse(activity.website_image_candidates_fetched_at) === Date.parse(activity.website_image_vision_candidates_fetched_at);
      return hasDownloadedImage && !currentSetAlreadyReviewed;
    }
    if (createdAfter) return Number.isFinite(Date.parse(activity.created_at)) && Date.parse(activity.created_at) >= Date.parse(createdAfter);
    return !activity.website_image_candidates_fetched_at;
  });
  const targets = eligible.slice(0, maxActivities);
  const batches = [];
  for (let index = 0; index < targets.length; index += batchSize) {
    const ids = targets.slice(index, index + batchSize).map((activity) => activity.activity_id);
    const response = await invokeDownloader(ids);
    batches.push(response);
    console.log(`Website candidate batch ${batches.length}: scanned ${response.processed} activities.`);
  }

  const results = batches.flatMap((batch) => batch.results || []);
  const summary = results.reduce((counts, result) => {
    counts[result.status] = (counts[result.status] || 0) + 1;
    return counts;
  }, {});
  const audit = {
    generated_at: new Date().toISOString(),
    source: linkedDatabase ? 'linked_database' : 'public_api',
    mode: reselectDownloaded ? 'reselect_downloaded' : createdAfter ? 'created_after' : 'unscanned',
    created_after: createdAfter,
    scanned: activities.length,
    targeted: targets.length,
    skipped_by_limit: Math.max(0, eligible.length - targets.length),
    summary,
    results,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(audit, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Website candidate discovery audit: ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
